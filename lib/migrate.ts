// lib/migrate.ts
// -----------------------------------------------------------------------------
// Idempotent, run-once schema migrations for the APPLICATION database.
//
// initializeAppSchema() (lib/setup.ts) only runs during the first-time /setup
// wizard, so a database provisioned before a feature shipped never gets its new
// columns/tables. This module bridges that gap: it is safe to call on every
// boot / first data access, checks what already exists, and only applies what's
// missing. Fresh installs get the same shapes from setup.ts, so this is a no-op
// for them.
//
// Migrations here:
//   v2 — scheduled-report timing + recipients/sharing:
//     * app_report_schedules  += run_hour, run_minute, day_of_month, month_of_year
//     * app_report_recipients  (schedule_id, user_id)  — auto-deliver targets
//     * app_report_shares      (report_id,  user_id)   — one-off shared reports
//   v3 — email delivery of scheduled reports:
//     * app_report_schedules  += email_note (optional intro line in the email)
//     * app_report_email_recipients (schedule_id, email) — external addresses a
//       schedule emails the report to, alongside the internal app-user recipients
// -----------------------------------------------------------------------------
import { appDb, appQuery } from "./db";

// ---- introspection helpers ---------------------------------------------------

async function mysqlColumnExists(table: string, column: string): Promise<boolean> {
  const rows = await appQuery<{ n: number }>(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column],
  );
  return Number(rows[0]?.n ?? 0) > 0;
}

async function mssqlColumnExists(table: string, column: string): Promise<boolean> {
  const rows = await appQuery<{ n: number }>(
    `SELECT COUNT(*) AS n FROM sys.columns
      WHERE object_id = OBJECT_ID(?) AND name = ?`,
    [`dbo.${table}`, column],
  );
  return Number(rows[0]?.n ?? 0) > 0;
}

// ---- the migration -----------------------------------------------------------

// Columns to add to app_report_schedules, with their per-dialect types. The
// timing four came in v2; email_note in v3. All are additive + nullable/defaulted
// so applying them to an existing table never fails.
const SCHEDULE_COLUMNS: { name: string; mysql: string; mssql: string }[] = [
  { name: "run_hour", mysql: "INT NOT NULL DEFAULT 6", mssql: "INT NOT NULL DEFAULT 6" },
  { name: "run_minute", mysql: "INT NOT NULL DEFAULT 0", mssql: "INT NOT NULL DEFAULT 0" },
  { name: "day_of_month", mysql: "INT NOT NULL DEFAULT 1", mssql: "INT NOT NULL DEFAULT 1" },
  { name: "month_of_year", mysql: "INT NOT NULL DEFAULT 1", mssql: "INT NOT NULL DEFAULT 1" },
  { name: "email_note", mysql: "VARCHAR(1000) NULL", mssql: "NVARCHAR(1000) NULL" },
];

async function migrateMysql(): Promise<void> {
  for (const c of SCHEDULE_COLUMNS) {
    if (!(await mysqlColumnExists("app_report_schedules", c.name))) {
      await appQuery(`ALTER TABLE app_report_schedules ADD COLUMN ${c.name} ${c.mysql}`);
    }
  }
  // External email recipients (ASCII column keeps the composite PK well under
  // InnoDB's index-length limit).
  await appQuery(
    `CREATE TABLE IF NOT EXISTS app_report_email_recipients (
       schedule_id BIGINT UNSIGNED NOT NULL,
       email       VARCHAR(320) CHARACTER SET ascii NOT NULL,
       PRIMARY KEY (schedule_id, email),
       FOREIGN KEY (schedule_id) REFERENCES app_report_schedules(id) ON DELETE CASCADE
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  );
  await appQuery(
    `CREATE TABLE IF NOT EXISTS app_report_recipients (
       schedule_id BIGINT UNSIGNED NOT NULL,
       user_id     BIGINT UNSIGNED NOT NULL,
       PRIMARY KEY (schedule_id, user_id),
       FOREIGN KEY (schedule_id) REFERENCES app_report_schedules(id) ON DELETE CASCADE,
       FOREIGN KEY (user_id)     REFERENCES app_users(id) ON DELETE CASCADE
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  );
  await appQuery(
    `CREATE TABLE IF NOT EXISTS app_report_shares (
       report_id  BIGINT UNSIGNED NOT NULL,
       user_id    BIGINT UNSIGNED NOT NULL,
       created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
       PRIMARY KEY (report_id, user_id),
       FOREIGN KEY (report_id) REFERENCES app_generated_reports(id) ON DELETE CASCADE,
       FOREIGN KEY (user_id)   REFERENCES app_users(id) ON DELETE CASCADE,
       INDEX idx_share_user (user_id)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  );
}

async function migrateMssql(): Promise<void> {
  for (const c of SCHEDULE_COLUMNS) {
    if (!(await mssqlColumnExists("app_report_schedules", c.name))) {
      await appQuery(`ALTER TABLE app_report_schedules ADD ${c.name} ${c.mssql}`);
    }
  }
  // External email recipients. VARCHAR (non-unicode) keeps the composite PK
  // under SQL Server's 900-byte index-key limit.
  await appQuery(
    `IF OBJECT_ID(N'dbo.app_report_email_recipients', N'U') IS NULL
     CREATE TABLE app_report_email_recipients (
       schedule_id BIGINT NOT NULL,
       email       VARCHAR(320) NOT NULL,
       PRIMARY KEY (schedule_id, email),
       FOREIGN KEY (schedule_id) REFERENCES app_report_schedules(id) ON DELETE CASCADE
     )`,
  );
  // SQL Server forbids multiple ON DELETE CASCADE paths to the same table; the
  // user_id FK therefore uses NO ACTION (rows are cleaned up in app code / by
  // the schedule/report cascade). Mirrors the app_messages approach.
  await appQuery(
    `IF OBJECT_ID(N'dbo.app_report_recipients', N'U') IS NULL
     CREATE TABLE app_report_recipients (
       schedule_id BIGINT NOT NULL,
       user_id     BIGINT NOT NULL,
       PRIMARY KEY (schedule_id, user_id),
       FOREIGN KEY (schedule_id) REFERENCES app_report_schedules(id) ON DELETE CASCADE,
       FOREIGN KEY (user_id)     REFERENCES app_users(id)
     )`,
  );
  await appQuery(
    `IF OBJECT_ID(N'dbo.app_report_shares', N'U') IS NULL
     CREATE TABLE app_report_shares (
       report_id  BIGINT NOT NULL,
       user_id    BIGINT NOT NULL,
       created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
       PRIMARY KEY (report_id, user_id),
       FOREIGN KEY (report_id) REFERENCES app_generated_reports(id) ON DELETE CASCADE,
       FOREIGN KEY (user_id)   REFERENCES app_users(id)
     )`,
  );
  await appQuery(
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_share_user' AND object_id = OBJECT_ID('dbo.app_report_shares'))
     CREATE INDEX idx_share_user ON app_report_shares(user_id)`,
  );
}

// Run-once guard: the first caller kicks off the migration; everyone else awaits
// the same promise. On failure the promise is cleared so a later call retries.
let _once: Promise<void> | null = null;

export function ensureAppMigrations(): Promise<void> {
  if (_once) return _once;
  _once = (async () => {
    if (appDb().dialect === "mssql") await migrateMssql();
    else await migrateMysql();
  })().catch((e) => {
    _once = null;
    throw e;
  });
  return _once;
}
