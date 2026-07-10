// lib/setup.ts
// -----------------------------------------------------------------------------
// First-run provisioning, driven by the /setup wizard:
//   1. create the application tables (users / RLS map / audit / saved filters),
//   2. create the first ADMIN user.
// Both are dialect-aware so the app DB can be MySQL or SQL Server. The QMS
// analytics views are NOT touched here — those live on the bank's read-only
// replica and are provisioned by ops (see db/schema.sql, PART A).
// -----------------------------------------------------------------------------

import { hash as argonHash } from "@node-rs/argon2";
import type { DbEngine } from "./app-config";
import type { DbAdapter } from "./db-adapters";

// Each string is a single statement; adapters send them one at a time
// (multipleStatements is off for injection safety).
const DDL: Record<DbEngine, string[]> = {
  mysql: [
    `CREATE TABLE IF NOT EXISTS app_users (
       id              BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
       email           VARCHAR(255) NOT NULL UNIQUE,
       full_name       VARCHAR(255) NOT NULL,
       password_hash   VARCHAR(255) NOT NULL,
       role            ENUM('SUPER_ADMIN','ADMIN','BRANCH_OPS')
                         NOT NULL DEFAULT 'BRANCH_OPS',
       is_active       TINYINT(1) NOT NULL DEFAULT 1,
       failed_attempts INT NOT NULL DEFAULT 0,
       locked_until    DATETIME NULL,
       last_login      DATETIME NULL,
       created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS app_user_branches (
       user_id   BIGINT UNSIGNED NOT NULL,
       branch_id VARCHAR(191) NOT NULL,
       PRIMARY KEY (user_id, branch_id),
       FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS app_audit_log (
       id         BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
       ts         VARCHAR(40) NOT NULL,
       user_id    BIGINT UNSIGNED NULL,
       action     VARCHAR(40) NOT NULL,
       resource   VARCHAR(120) NOT NULL,
       details    JSON NOT NULL,
       ip         VARCHAR(64) NULL,
       user_agent VARCHAR(512) NULL,
       prev_hash  CHAR(64) NOT NULL,
       hash       CHAR(64) NOT NULL,
       INDEX idx_audit_user (user_id),
       INDEX idx_audit_action (action),
       INDEX idx_audit_ts (ts)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS app_saved_filters (
       id         BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
       user_id    BIGINT UNSIGNED NOT NULL,
       name       VARCHAR(120) NOT NULL,
       payload    JSON NOT NULL,
       created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
       FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS app_messages (
       id              BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
       sender_id       BIGINT UNSIGNED NOT NULL,
       recipient_id    BIGINT UNSIGNED NOT NULL,
       body            TEXT NOT NULL,
       attachment_key  VARCHAR(191) NULL,
       attachment_name VARCHAR(255) NULL,
       attachment_mime VARCHAR(100) NULL,
       attachment_size INT NULL,
       created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
       edited_at       DATETIME NULL,
       read_at         DATETIME NULL,
       FOREIGN KEY (sender_id)    REFERENCES app_users(id) ON DELETE CASCADE,
       FOREIGN KEY (recipient_id) REFERENCES app_users(id) ON DELETE CASCADE,
       INDEX idx_msg_pair (sender_id, recipient_id),
       INDEX idx_msg_inbox (recipient_id, read_at)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS app_settings (
       setting_key   VARCHAR(64) PRIMARY KEY,
       setting_value VARCHAR(255) NOT NULL
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS app_report_schedules (
       id          BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
       user_id     BIGINT UNSIGNED NOT NULL,
       name        VARCHAR(120) NOT NULL,
       report_type VARCHAR(20) NOT NULL,
       format      VARCHAR(8) NOT NULL,
       is_active   TINYINT(1) NOT NULL DEFAULT 1,
       next_run_at DATETIME NOT NULL,
       last_run_at DATETIME NULL,
       created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
       FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE,
       INDEX idx_sched_due (is_active, next_run_at)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS app_generated_reports (
       id           BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
       user_id      BIGINT UNSIGNED NOT NULL,
       schedule_id  BIGINT UNSIGNED NULL,
       file_key     VARCHAR(191) NOT NULL,
       display_name VARCHAR(191) NOT NULL,
       format       VARCHAR(8) NOT NULL,
       period_label VARCHAR(80) NOT NULL,
       byte_size    INT NOT NULL DEFAULT 0,
       created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
       FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE,
       INDEX idx_genrep_user (user_id, created_at)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  ],
  mssql: [
    `IF OBJECT_ID(N'dbo.app_users', N'U') IS NULL
     CREATE TABLE app_users (
       id              BIGINT IDENTITY(1,1) PRIMARY KEY,
       email           NVARCHAR(255) NOT NULL UNIQUE,
       full_name       NVARCHAR(255) NOT NULL,
       password_hash   NVARCHAR(255) NOT NULL,
       role            NVARCHAR(20) NOT NULL DEFAULT 'BRANCH_OPS'
                         CHECK (role IN ('SUPER_ADMIN','ADMIN','BRANCH_OPS')),
       is_active       BIT NOT NULL DEFAULT 1,
       failed_attempts INT NOT NULL DEFAULT 0,
       locked_until    DATETIME2 NULL,
       last_login      DATETIME2 NULL,
       created_at      DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
     )`,
    `IF OBJECT_ID(N'dbo.app_user_branches', N'U') IS NULL
     CREATE TABLE app_user_branches (
       user_id   BIGINT NOT NULL,
       branch_id NVARCHAR(191) NOT NULL,
       PRIMARY KEY (user_id, branch_id),
       FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE
     )`,
    `IF OBJECT_ID(N'dbo.app_audit_log', N'U') IS NULL
     CREATE TABLE app_audit_log (
       id         BIGINT IDENTITY(1,1) PRIMARY KEY,
       ts         VARCHAR(40) NOT NULL,
       user_id    BIGINT NULL,
       action     VARCHAR(40) NOT NULL,
       resource   VARCHAR(120) NOT NULL,
       details    NVARCHAR(MAX) NOT NULL,
       ip         VARCHAR(64) NULL,
       user_agent VARCHAR(512) NULL,
       prev_hash  CHAR(64) NOT NULL,
       hash       CHAR(64) NOT NULL
     )`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_audit_user' AND object_id = OBJECT_ID('dbo.app_audit_log'))
     CREATE INDEX idx_audit_user ON app_audit_log(user_id)`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_audit_action' AND object_id = OBJECT_ID('dbo.app_audit_log'))
     CREATE INDEX idx_audit_action ON app_audit_log(action)`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_audit_ts' AND object_id = OBJECT_ID('dbo.app_audit_log'))
     CREATE INDEX idx_audit_ts ON app_audit_log(ts)`,
    `IF OBJECT_ID(N'dbo.app_saved_filters', N'U') IS NULL
     CREATE TABLE app_saved_filters (
       id         BIGINT IDENTITY(1,1) PRIMARY KEY,
       user_id    BIGINT NOT NULL,
       name       NVARCHAR(120) NOT NULL,
       payload    NVARCHAR(MAX) NOT NULL,
       created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
       FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE
     )`,
    // Two FKs to app_users: SQL Server forbids multiple ON DELETE CASCADE paths
    // to the same table (error 1785), so these use NO ACTION (the default).
    `IF OBJECT_ID(N'dbo.app_messages', N'U') IS NULL
     CREATE TABLE app_messages (
       id              BIGINT IDENTITY(1,1) PRIMARY KEY,
       sender_id       BIGINT NOT NULL,
       recipient_id    BIGINT NOT NULL,
       body            NVARCHAR(MAX) NOT NULL,
       attachment_key  NVARCHAR(191) NULL,
       attachment_name NVARCHAR(255) NULL,
       attachment_mime NVARCHAR(100) NULL,
       attachment_size INT NULL,
       created_at      DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
       edited_at       DATETIME2 NULL,
       read_at         DATETIME2 NULL,
       FOREIGN KEY (sender_id)    REFERENCES app_users(id),
       FOREIGN KEY (recipient_id) REFERENCES app_users(id)
     )`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_msg_pair' AND object_id = OBJECT_ID('dbo.app_messages'))
     CREATE INDEX idx_msg_pair ON app_messages(sender_id, recipient_id)`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_msg_inbox' AND object_id = OBJECT_ID('dbo.app_messages'))
     CREATE INDEX idx_msg_inbox ON app_messages(recipient_id, read_at)`,
    `IF OBJECT_ID(N'dbo.app_settings', N'U') IS NULL
     CREATE TABLE app_settings (
       setting_key   NVARCHAR(64) PRIMARY KEY,
       setting_value NVARCHAR(255) NOT NULL
     )`,
    `IF OBJECT_ID(N'dbo.app_report_schedules', N'U') IS NULL
     CREATE TABLE app_report_schedules (
       id          BIGINT IDENTITY(1,1) PRIMARY KEY,
       user_id     BIGINT NOT NULL,
       name        NVARCHAR(120) NOT NULL,
       report_type NVARCHAR(20) NOT NULL,
       format      NVARCHAR(8) NOT NULL,
       is_active   BIT NOT NULL DEFAULT 1,
       next_run_at DATETIME2 NOT NULL,
       last_run_at DATETIME2 NULL,
       created_at  DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
       FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE
     )`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_sched_due' AND object_id = OBJECT_ID('dbo.app_report_schedules'))
     CREATE INDEX idx_sched_due ON app_report_schedules(is_active, next_run_at)`,
    `IF OBJECT_ID(N'dbo.app_generated_reports', N'U') IS NULL
     CREATE TABLE app_generated_reports (
       id           BIGINT IDENTITY(1,1) PRIMARY KEY,
       user_id      BIGINT NOT NULL,
       schedule_id  BIGINT NULL,
       file_key     NVARCHAR(191) NOT NULL,
       display_name NVARCHAR(191) NOT NULL,
       format       NVARCHAR(8) NOT NULL,
       period_label NVARCHAR(80) NOT NULL,
       byte_size    INT NOT NULL DEFAULT 0,
       created_at   DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
       FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE
     )`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_genrep_user' AND object_id = OBJECT_ID('dbo.app_generated_reports'))
     CREATE INDEX idx_genrep_user ON app_generated_reports(user_id, created_at)`,
  ],
};

/** Create the application tables if they don't already exist. Idempotent. */
export async function initializeAppSchema(adapter: DbAdapter): Promise<void> {
  for (const statement of DDL[adapter.dialect]) {
    await adapter.query(statement);
  }
}

interface CountRow {
  n: number;
}

/** True if at least one user already exists (i.e. the app was seeded before). */
export async function hasAnyUser(adapter: DbAdapter): Promise<boolean> {
  const rows = await adapter.query<CountRow>("SELECT COUNT(*) AS n FROM app_users");
  return Number(rows[0]?.n ?? 0) > 0;
}

export interface FirstAdmin {
  email: string;
  fullName: string;
  password: string;
}

/**
 * Create the first SUPER_ADMIN account. The super admin sees all branches and
 * is the account from which every other user is later added, so no branch
 * scope rows are needed.
 */
export async function createFirstSuperAdmin(adapter: DbAdapter, admin: FirstAdmin): Promise<void> {
  const passwordHash = await argonHash(admin.password, {
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
  await adapter.query(
    `INSERT INTO app_users (email, full_name, password_hash, role, is_active)
     VALUES (?, ?, ?, 'SUPER_ADMIN', 1)`,
    [admin.email.toLowerCase(), admin.fullName, passwordHash],
  );
}
