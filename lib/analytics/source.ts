// lib/analytics/source.ts
// -----------------------------------------------------------------------------
// QMS "source mode" — how the ticket data is laid out in the client's QMS DB.
//
//   old  -> the classic single `banktickets` fact table (the original layout).
//   new  -> the newer deployment where the authoritative, live ticket values
//           live inside `counters.tickets` (a JSON array per counter), with
//           `banktickets` as the fallback. Branch/queue/service/agent names come
//           from branches / queues / sub_menu_items / users.
//
// The whole analytics layer reads `FROM <tickets> t` and joins the dimension
// tables. In BOTH modes those queries are identical — the only differences are
//   (a) which database the QMS pool points at (handled in lib/db.ts), and
//   (b) what `<tickets>` expands to (handled here).
// So switching modes changes zero query/RBAC/RLS logic.
//
// The merged NEW relation below exposes exactly the same columns the old
// `banktickets` table does, so it is a drop-in for `banktickets t`:
//   id, ticketNo, branchId, queueId, counterId, ticketStatus, issueDescription,
//   rating, ratingComment, createdAt, notServedAt, servingAt, servedAt,
//   notServedDuration, servingDuration, totalDuration
// -----------------------------------------------------------------------------

import { getQmsSourceMode, type QmsSourceMode } from "../settings";

export type { QmsSourceMode };

// JSON_TABLE string columns take the CONNECTION's collation, which may differ
// from the QMS tables' collation and then errors on join/compare ("Illegal mix
// of collations"). We pin them to the tables' collation. qms_db uses MySQL 8's
// default utf8mb4_0900_ai_ci; override via QMS_NEW_DB_COLLATION if a client's new
// database uses a different one. Validated against a safe identifier pattern
// because it is interpolated into SQL.
const NEW_COLLATION = /^[a-z0-9_]+$/i.test(process.env.QMS_NEW_DB_COLLATION ?? "")
  ? (process.env.QMS_NEW_DB_COLLATION as string)
  : "utf8mb4_0900_ai_ci";

// The NEW ticket relation: banktickets left-joined to the per-counter JSON, with
// the JSON value winning (COALESCE) and the counter supplying reliable staff
// attribution. Each ticket may appear in more than one counter's JSON (redirects)
// so we keep only the latest serving occurrence per ticket (ROW_NUMBER ... rn=1).
// Parameterless and built from constants only — safe to interpolate.
const NEW_TICKETS_MYSQL = `(
  SELECT
    t.id,
    t.ticketNo,
    t.branchId,
    t.queueId,
    COALESCE(ctr.c_id, t.counterId)        AS counterId,
    COALESCE(ctr.st, t.ticketStatus)       AS ticketStatus,
    COALESCE(smi.name, t.issueDescription) AS issueDescription,
    CAST(NULLIF(t.rating, '') AS UNSIGNED) AS rating,
    t.ratingComment,
    t.createdAt,
    COALESCE(ctr.nsat, t.notServedAt)      AS notServedAt,
    COALESCE(ctr.svat, t.servingAt)        AS servingAt,
    COALESCE(ctr.sdat, t.servedAt)         AS servedAt,
    COALESCE(ctr.nsd, t.notServedDuration) AS notServedDuration,
    COALESCE(ctr.svd, t.servingDuration)   AS servingDuration,
    COALESCE(ctr.td,  t.totalDuration)     AS totalDuration
  FROM banktickets t
  LEFT JOIN sub_menu_items smi ON t.subItemId = smi.id
  LEFT JOIN (
    SELECT c_id, ticketId, st, nsat, svat, sdat, nsd, svd, td FROM (
      SELECT
        c.id AS c_id, j.ticketId, j.st, j.nsat, j.svat, j.sdat, j.nsd, j.svd, j.td,
        ROW_NUMBER() OVER (PARTITION BY j.ticketId ORDER BY j.sdat DESC, j.svat DESC, j.nsat DESC) rn
      FROM counters c
      CROSS JOIN JSON_TABLE(COALESCE(c.tickets, '[]'), '$[*]' COLUMNS (
        ticketId VARCHAR(36) COLLATE ${NEW_COLLATION} PATH '$.ticketId',
        st       VARCHAR(50) COLLATE ${NEW_COLLATION} PATH '$.ticketStatus',
        nsat     DATETIME    PATH '$.notServedAt',
        svat     DATETIME    PATH '$.servingAt',
        sdat     DATETIME    PATH '$.servedAt',
        nsd      INT         PATH '$.notServedDuration',
        svd      INT         PATH '$.servingDuration',
        td       INT         PATH '$.totalDuration'
      )) j
      WHERE j.ticketId IS NOT NULL
    ) z WHERE rn = 1
  ) ctr ON ctr.ticketId = t.id
)`;

/** The SQL relation to use in place of `banktickets` for a given mode. */
export function ticketsExpr(mode: QmsSourceMode): string {
  return mode === "new" ? NEW_TICKETS_MYSQL : "banktickets";
}

export interface QmsSource {
  mode: QmsSourceMode;
  /** Expands to `banktickets` (old) or the merged JSON relation (new). */
  tickets: string;
}

/**
 * Resolve the active QMS source once per analytics call. Pass `source.mode` to
 * qmsQuery() (selects the right DB pool) and interpolate `source.tickets` in
 * place of the `banktickets` table.
 */
export async function qmsSource(): Promise<QmsSource> {
  const mode = await getQmsSourceMode();
  return { mode, tickets: ticketsExpr(mode) };
}
