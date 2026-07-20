// lib/audit.ts
// -----------------------------------------------------------------------------
// Tamper-evident audit trail.
//
// Every security-relevant action is written to app_audit_log. Each row stores
// the SHA-256 hash of (previous row's hash + this row's canonical content), so
// the log forms a chain: altering or deleting any historical row breaks every
// hash after it. Auditors can replay verifyChain() to prove integrity.
//
// This is the artifact you hand a bank security team when they ask
// "how do we know who saw what, and that the record wasn't edited?".
// -----------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { appQuery, appTransaction, appDb } from "./db";

export type AuditAction =
  | "LOGIN_SUCCESS"
  | "LOGIN_FAILURE"
  | "LOGOUT"
  | "METRICS_QUERY"
  | "DETAIL_QUERY"
  | "EXPORT"
  | "STREAM_OPEN"
  | "ACCESS_DENIED"
  // Administrative actions (the "who did what" a security team cares about).
  | "USER_CREATE"
  | "USER_UPDATE"
  | "USER_DELETE"
  | "PASSWORD_RESET"
  | "SETTINGS_CHANGE"
  | "REPORT_SCHEDULE"
  | "REPORT_SHARE"
  | "REPORT_EMAIL"
  | "ASSISTANT_QUERY";

/** Human labels for each action, used by the audit viewer. */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  LOGIN_SUCCESS: "Signed in",
  LOGIN_FAILURE: "Failed sign-in",
  LOGOUT: "Signed out",
  METRICS_QUERY: "Queried metrics",
  DETAIL_QUERY: "Queried detail",
  EXPORT: "Exported data",
  STREAM_OPEN: "Opened live stream",
  ACCESS_DENIED: "Access denied",
  USER_CREATE: "Created user",
  USER_UPDATE: "Updated user",
  USER_DELETE: "Deleted user",
  PASSWORD_RESET: "Reset password",
  SETTINGS_CHANGE: "Changed settings",
  REPORT_SCHEDULE: "Report schedule",
  REPORT_SHARE: "Shared report",
  REPORT_EMAIL: "Emailed report",
  ASSISTANT_QUERY: "Asked the AI assistant",
};

export interface AuditEntry {
  userId: number | null;
  action: AuditAction;
  resource: string; // e.g. "overview", "export:xlsx"
  details: Record<string, unknown>; // filters applied, row counts, etc.
  ip: string | null;
  userAgent: string | null;
}

/**
 * Read a stored `details` value back into an object. Depending on the engine /
 * driver the column may come back as a JSON string (SQL Server, TEXT columns)
 * OR as an already-parsed object (MySQL JSON columns auto-parse). Handle both.
 */
function parseDetails(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object") return v as Record<string, unknown>;
  if (typeof v === "string") {
    try {
      const p = JSON.parse(v);
      return p && typeof p === "object" ? (p as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return {};
}

// Exported for unit tests (determinism is the property the hash chain relies on).
export function canonical(value: unknown): string {
  // Deterministic stringify: recursively sort object keys so the hash is
  // stable regardless of insertion order — and, crucially, so NESTED objects
  // (like `details`) are fully included. (The array-replacer form of
  // JSON.stringify would silently drop nested keys and leave detail content
  // outside the integrity hash.)
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(canonical).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonical(obj[k])).join(",") + "}";
}

interface PrevRow {
  hash: string;
}

/**
 * Write one audit entry, chaining it to the previous row's hash.
 * Uses a transaction + row lock so concurrent writes can't fork the chain.
 */
export async function audit(entry: AuditEntry): Promise<void> {
  try {
    await appTransaction(async (tx) => {
      // Lock the tail of the chain so two concurrent writers can't read the
      // same prev_hash and fork it. Lock syntax differs by engine: MySQL uses
      // a trailing FOR UPDATE, SQL Server an UPDLOCK/HOLDLOCK table hint.
      const prevRows =
        tx.dialect === "mssql"
          ? await tx.query<PrevRow>(
              "SELECT TOP 1 hash FROM app_audit_log WITH (UPDLOCK, HOLDLOCK) ORDER BY id DESC",
            )
          : await tx.query<PrevRow>(
              "SELECT hash FROM app_audit_log ORDER BY id DESC LIMIT 1 FOR UPDATE",
            );
      const prevHash = prevRows[0]?.hash ?? "GENESIS";
      const ts = new Date().toISOString();

      const payload = {
        ts,
        userId: entry.userId,
        action: entry.action,
        resource: entry.resource,
        details: entry.details,
        ip: entry.ip,
        userAgent: entry.userAgent,
      };
      const hash = createHash("sha256")
        .update(prevHash + canonical(payload))
        .digest("hex");

      await tx.query(
        `INSERT INTO app_audit_log
           (ts, user_id, action, resource, details, ip, user_agent, prev_hash, hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          ts,
          entry.userId,
          entry.action,
          entry.resource,
          JSON.stringify(entry.details),
          entry.ip,
          entry.userAgent,
          prevHash,
          hash,
        ],
      );
    });
  } catch (err) {
    // Never let an audit failure silently swallow the action, but also never
    // crash the request path. Log to stderr for the platform's log shipper.
    console.error("AUDIT_WRITE_FAILED", err);
    throw err;
  }
}

interface ChainRow {
  id: number;
  ts: string;
  user_id: number | null;
  action: string;
  resource: string;
  details: string;
  ip: string | null;
  user_agent: string | null;
  prev_hash: string;
  hash: string;
}

/**
 * Walk the whole chain and confirm each hash still matches its content.
 * Returns the id of the first broken link, or null if the chain is intact.
 * Run this from a scheduled integrity job and surface the result to auditors.
 */
export async function verifyChain(): Promise<{ ok: boolean; brokenAtId: number | null }> {
  const rows = await appQuery<ChainRow>(
    "SELECT * FROM app_audit_log ORDER BY id ASC",
  );
  let prevHash = "GENESIS";
  for (const r of rows) {
    const payload = {
      ts: r.ts,
      userId: r.user_id,
      action: r.action,
      resource: r.resource,
      details: parseDetails(r.details),
      ip: r.ip,
      userAgent: r.user_agent,
    };
    const expected = createHash("sha256")
      .update(prevHash + canonical(payload))
      .digest("hex");
    if (expected !== r.hash || r.prev_hash !== prevHash) {
      return { ok: false, brokenAtId: r.id };
    }
    prevHash = r.hash;
  }
  return { ok: true, brokenAtId: null };
}

// ---- Convenience writer + viewer query --------------------------------------

/** Best-effort audit that pulls IP + user-agent from the request and never throws. */
export async function auditFromRequest(
  req: Request,
  actorId: number | null,
  action: AuditAction,
  resource: string,
  details: Record<string, unknown>,
): Promise<void> {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    null;
  const userAgent = req.headers.get("user-agent");
  try {
    await audit({ userId: actorId, action, resource, details, ip, userAgent });
  } catch {
    // Instrumentation must never break the action it records.
  }
}

export interface AuditRecord {
  id: number;
  ts: string;
  userId: number | null;
  actorName: string | null;
  actorEmail: string | null;
  action: string;
  resource: string;
  details: Record<string, unknown>;
  ip: string | null;
  userAgent: string | null;
}

export interface AuditQuery {
  action?: string;
  limit?: number;
  offset?: number;
}

interface ListRow extends ChainRow {
  full_name: string | null;
  email: string | null;
}

/** Page of audit entries (newest first) with the actor's name resolved. */
export async function listAuditEntries(q: AuditQuery = {}): Promise<{ entries: AuditRecord[]; total: number }> {
  const limit = Math.min(Math.max(q.limit ?? 100, 1), 500);
  const offset = Math.max(q.offset ?? 0, 0);
  const where = q.action ? "WHERE a.action = ?" : "";
  const filterParams = q.action ? [q.action] : [];

  const totalRows = await appQuery<{ n: number }>(
    `SELECT COUNT(*) AS n FROM app_audit_log a ${where}`,
    filterParams,
  );

  // Pagination clause differs by engine; limit/offset are validated integers
  // above, so inlining them is safe (they can't be bound as parameters in
  // LIMIT/FETCH on every driver).
  const page =
    appDb().dialect === "mssql"
      ? `OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`
      : `LIMIT ${limit} OFFSET ${offset}`;

  const rows = await appQuery<ListRow>(
    `SELECT a.id, a.ts, a.user_id, a.action, a.resource, a.details, a.ip, a.user_agent,
            a.prev_hash, a.hash, u.full_name, u.email
       FROM app_audit_log a
       LEFT JOIN app_users u ON u.id = a.user_id
       ${where}
      ORDER BY a.id DESC
      ${page}`,
    filterParams,
  );

  const entries = rows.map((r) => ({
    id: Number(r.id),
    ts: r.ts,
    userId: r.user_id != null ? Number(r.user_id) : null,
    actorName: r.full_name ?? null,
    actorEmail: r.email ?? null,
    action: r.action,
    resource: r.resource,
    details: parseDetails(r.details),
    ip: r.ip,
    userAgent: r.user_agent,
  }));
  return { entries, total: Number(totalRows[0]?.n ?? 0) };
}
