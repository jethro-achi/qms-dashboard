// lib/analytics/status.ts
// Lightweight "is the data live, and how fresh is it?" probe for the header
// status indicator + refresh flow. Runs a single cheap query against the QMS
// replica; any failure is treated as "offline" (the DB is unreachable).
import type { RowDataPacket } from "mysql2";
import { qmsQuery } from "../db";
import type { Principal } from "../rbac";
import { EMPTY_FILTERS } from "./filters";
import { buildWhere } from "./queries";

export interface DataStatus {
  online: boolean;
  /** ISO-8601 UTC timestamp of the most recent ticket, or null if none. */
  lastUpdatedIso: string | null;
  /** The server's clock at probe time, so the client can compute "x ago". */
  serverNowIso: string;
}

export async function getDataStatus(principal: Principal): Promise<DataStatus> {
  const serverNowIso = new Date().toISOString();
  try {
    // Branch-scoped so a branch user sees their own data's freshness. The value
    // is formatted as an explicit UTC ISO string to avoid driver TZ ambiguity.
    const w = buildWhere(EMPTY_FILTERS, principal);
    const rows = await qmsQuery<RowDataPacket & { m: string | null }>(
      `SELECT DATE_FORMAT(MAX(t.createdAt), '%Y-%m-%dT%H:%i:%sZ') AS m
         FROM banktickets t ${w.clause}`,
      w.params,
    );
    return { online: true, lastUpdatedIso: rows[0]?.m ?? null, serverNowIso };
  } catch {
    return { online: false, lastUpdatedIso: null, serverNowIso };
  }
}
