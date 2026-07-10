// lib/db.ts
// -----------------------------------------------------------------------------
// Two data sources, deliberately separated:
//   QMS   -> the bank's QMS data, READ-ONLY, on a replica, views only.
//            Configured by ops via QMS_DB_* env vars (mysql2).
//   app   -> your application DB (users, audit log, saved filters).
//            Configured ONCE through the /setup wizard, then read from
//            data/app-config.json via a pluggable engine adapter, so the app
//            can run on MySQL, SQL Server, or a future engine (see
//            lib/db-adapters/).
//
// Security posture baked in here:
//   * Both paths use PREPARED STATEMENTS / bound parameters. We never
//     concatenate user input into SQL — the single most important injection
//     defence. App-side SQL is written with `?` placeholders; each adapter
//     binds them for its driver.
//   * Any column that comes from the client (sort column, group-by) is checked
//     against an ALLOW-LIST before it can touch a query. Values are always
//     bound; only *identifiers* need allow-listing.
// -----------------------------------------------------------------------------

import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { readAppConfig } from "./app-config";
import { createAdapter, type DbAdapter, type TxContext } from "./db-adapters";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

// ---- QMS replica pool (READ-ONLY) -------------------------------------------
// The DB *user* configured here must be granted SELECT only, and only on the
// analytics views (see db/schema.sql). Enforcing read-only at the grant level
// means the app physically cannot mutate the bank's queue data.
//
// Lazily constructed: importing this module (e.g. during first-run /setup,
// before QMS_DB_* are necessarily present) must not throw.
let _qmsPool: Pool | null = null;
export function qmsPool(): Pool {
  if (_qmsPool) return _qmsPool;
  _qmsPool = mysql.createPool({
    host: required("QMS_DB_HOST"),
    port: Number(process.env.QMS_DB_PORT ?? 3306),
    user: required("QMS_DB_USER"),
    password: required("QMS_DB_PASSWORD"),
    database: required("QMS_DB_NAME"),
    waitForConnections: true,
    connectionLimit: Number(process.env.QMS_DB_POOL ?? 10),
    maxIdle: 10,
    idleTimeout: 60_000,
    enableKeepAlive: true,
    // Reject anything that isn't a plain SELECT result set.
    multipleStatements: false,
    // TLS to the DB. Point CA at the bank's cert; do NOT disable verification.
    ssl: process.env.QMS_DB_CA
      ? { ca: process.env.QMS_DB_CA, rejectUnauthorized: true }
      : undefined,
  });
  return _qmsPool;
}

// ---- Application adapter -----------------------------------------------------
// Built once, lazily, from the credentials the operator entered in /setup.
// Throws a clear error if the app hasn't been configured yet — callers on the
// authenticated path should never hit this because middleware forces /setup
// first, but failing loud beats a cryptic driver error.
let _appAdapter: DbAdapter | null = null;
export function appDb(): DbAdapter {
  if (_appAdapter) return _appAdapter;
  const config = readAppConfig();
  if (!config) {
    throw new Error("Application database is not configured yet. Complete /setup first.");
  }
  _appAdapter = createAdapter(config);
  return _appAdapter;
}

// ---- Safe query helpers -----------------------------------------------------

/**
 * Run a parameterized read against the QMS replica.
 * `params` are always bound — never interpolated.
 */
export async function qmsQuery<T extends RowDataPacket>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const [rows] = await qmsPool().execute<T[]>(sql, params as unknown[] as never);
  return rows;
}

/** Run a parameterized query against the application DB (engine-agnostic). */
export async function appQuery<T = unknown>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return appDb().query<T>(sql, params);
}

/** Run `fn` inside a single application-DB transaction. */
export async function appTransaction<T>(fn: (tx: TxContext) => Promise<T>): Promise<T> {
  return appDb().transaction(fn);
}

// ---- Identifier allow-list --------------------------------------------------

/**
 * Client-supplied column names (ORDER BY, GROUP BY) cannot be bound as
 * parameters, so they MUST be validated against a fixed set. Anything not on
 * the list is rejected before it reaches SQL.
 */
export const SORTABLE_COLUMNS = new Set<string>([
  "branch_name",
  "service_type",
  "tickets_served",
  "avg_wait_seconds",
  "avg_service_seconds",
  "abandonment_rate",
  "sla_compliance",
  "bucket_start",
]);

export function assertSortColumn(col: string): string {
  if (!SORTABLE_COLUMNS.has(col)) {
    throw new Error(`Disallowed sort column: ${col}`);
  }
  return col;
}

export function assertSortDir(dir: string): "ASC" | "DESC" {
  return dir.toUpperCase() === "ASC" ? "ASC" : "DESC";
}
