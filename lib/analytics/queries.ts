// lib/analytics/queries.ts
// -----------------------------------------------------------------------------
// Read-only analytics over the QMS `banktickets` fact table (+ branches/queues
// dimensions). Everything is parameterized and passes through a single WHERE
// builder that applies BOTH the global filters and the caller's branch-scope
// RLS, so a branch-scoped user can never see rows outside their branches and a
// client filter can only ever narrow, never widen, that scope.
// -----------------------------------------------------------------------------

import type { RowDataPacket } from "mysql2";
import { qmsQuery } from "../db";
import { seesAllBranches, type Principal } from "../rbac";
import { getAppMetrics } from "../settings";
import { cached, analyticsKey } from "../cache";
import type { AnalyticsFilters } from "./filters";

export const SLA_SECONDS = Number(process.env.QMS_SLA_SECONDS ?? 300);
export const TZ_OFFSET = process.env.QMS_TZ_OFFSET ?? "+00:00";

function inList(col: string, values: string[], params: unknown[]): string {
  params.push(...values);
  return `${col} IN (${values.map(() => "?").join(", ")})`;
}

/**
 * Build the shared WHERE clause. Branch scope is applied first (RLS), then the
 * client's filters — both AND-ed, so requested branches outside a scoped user's
 * allowance simply match nothing.
 */
export function buildWhere(filters: AnalyticsFilters, principal: Principal): { clause: string; params: unknown[] } {
  const conds: string[] = [];
  const params: unknown[] = [];

  if (!seesAllBranches(principal.role)) {
    const ids = principal.allowedBranchIds.map(String);
    if (ids.length === 0) conds.push("1 = 0"); // fail closed
    else conds.push(inList("t.branchId", ids, params));
  }

  if (filters.branchIds?.length) conds.push(inList("t.branchId", filters.branchIds, params));
  if (filters.queueIds?.length) conds.push(inList("t.queueId", filters.queueIds, params));
  if (filters.statuses?.length) conds.push(inList("t.ticketStatus", filters.statuses, params));
  if (filters.dateFrom) {
    conds.push("t.createdAt >= ?");
    params.push(`${filters.dateFrom} 00:00:00`);
  }
  if (filters.dateTo) {
    // inclusive of the whole end day
    conds.push("t.createdAt < DATE_ADD(?, INTERVAL 1 DAY)");
    params.push(`${filters.dateTo} 00:00:00`);
  }

  return { clause: conds.length ? `WHERE ${conds.join(" AND ")}` : "", params };
}

// ---- KPIs -------------------------------------------------------------------

interface KpiRow extends RowDataPacket {
  totalTraffic: number;
  served: number;
  notServed: number;
  serving: number;
  waiting: number;
  avgServiceSec: number | null;
  avgWaitSec: number | null;
  avgTotalSec: number | null;
  withinSla: number;
  ratedCount: number;
  avgRating: number | null;
  minCreated: string | null;
  maxCreated: string | null;
}

export interface Kpis {
  totalTraffic: number;
  served: number;
  servedPct: number;
  noShows: number;
  noShowPct: number;
  serving: number;
  waiting: number;
  avgServiceMin: number;
  avgWaitMin: number;
  avgTotalMin: number;
  slaPct: number;
  ratedCount: number;
  avgRating: number;
  minCreated: string | null;
  maxCreated: string | null;
}

export async function getKpis(filters: AnalyticsFilters, principal: Principal): Promise<Kpis> {
  const { clause, params } = buildWhere(filters, principal);
  const { slaSeconds } = await getAppMetrics();
  const rows = await cached(analyticsKey("kpis", filters, principal, [slaSeconds]), () =>
    qmsQuery<KpiRow>(
    `SELECT
        COUNT(*)                                                          AS totalTraffic,
        SUM(t.ticketStatus = 'Served')                                    AS served,
        SUM(t.ticketStatus = 'Not Served')                                AS notServed,
        SUM(t.ticketStatus = 'Serving')                                   AS serving,
        SUM(t.ticketStatus = 'Waiting')                                   AS waiting,
        AVG(CASE WHEN t.ticketStatus = 'Served' THEN t.servingDuration END) AS avgServiceSec,
        AVG(t.notServedDuration)                                          AS avgWaitSec,
        AVG(CASE WHEN t.ticketStatus = 'Served' THEN t.totalDuration END) AS avgTotalSec,
        SUM(CASE WHEN t.ticketStatus = 'Served' AND t.notServedDuration <= ? THEN 1 ELSE 0 END) AS withinSla,
        SUM(t.rating IS NOT NULL)                                         AS ratedCount,
        AVG(t.rating)                                                     AS avgRating,
        MIN(t.createdAt)                                                  AS minCreated,
        MAX(t.createdAt)                                                  AS maxCreated
       FROM banktickets t
       ${clause}`,
    [slaSeconds, ...params],
  ));
  const r = rows[0];
  const total = Number(r?.totalTraffic ?? 0);
  const served = Number(r?.served ?? 0);
  const noShows = Number(r?.notServed ?? 0);
  const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);
  const min1 = (sec: number | null) => Math.round(((sec ?? 0) / 60) * 10) / 10;

  return {
    totalTraffic: total,
    served,
    servedPct: pct(served, total),
    noShows,
    noShowPct: pct(noShows, total),
    serving: Number(r?.serving ?? 0),
    waiting: Number(r?.waiting ?? 0),
    avgServiceMin: min1(r?.avgServiceSec ?? 0),
    avgWaitMin: min1(r?.avgWaitSec ?? 0),
    avgTotalMin: min1(r?.avgTotalSec ?? 0),
    slaPct: pct(Number(r?.withinSla ?? 0), served),
    ratedCount: Number(r?.ratedCount ?? 0),
    avgRating: Math.round(Number(r?.avgRating ?? 0) * 10) / 10,
    minCreated: r?.minCreated ? new Date(r.minCreated).toISOString() : null,
    maxCreated: r?.maxCreated ? new Date(r.maxCreated).toISOString() : null,
  };
}

// ---- Top traffic drivers (by service description) ---------------------------

interface DriverRow extends RowDataPacket {
  label: string;
  value: number;
}

export interface Driver {
  label: string;
  value: number;
}

export async function getTopDrivers(
  filters: AnalyticsFilters,
  principal: Principal,
  limit = 10,
): Promise<Driver[]> {
  const { clause, params } = buildWhere(filters, principal);
  const rows = await cached(analyticsKey("drivers", filters, principal, [Number(limit)]), () =>
    qmsQuery<DriverRow>(
    `SELECT t.issueDescription AS label, COUNT(*) AS value
       FROM banktickets t
       ${clause}
      GROUP BY t.issueDescription
      ORDER BY value DESC
      LIMIT ${Number(limit)}`,
    params,
  ));
  return rows.map((r) => ({ label: r.label, value: Number(r.value) }));
}

// ---- Hourly traffic ---------------------------------------------------------

interface HourRow extends RowDataPacket {
  hour: number;
  value: number;
}

export interface HourBucket {
  hour: number; // 0-23, local time
  label: string; // "09:00"
  value: number;
}

export async function getHourlyTraffic(
  filters: AnalyticsFilters,
  principal: Principal,
): Promise<HourBucket[]> {
  const { clause, params } = buildWhere(filters, principal);
  // Convert stored UTC to the configured local zone before bucketing by hour.
  const rows = await cached(analyticsKey("hourly", filters, principal, [TZ_OFFSET]), () =>
    qmsQuery<HourRow>(
    `SELECT HOUR(CONVERT_TZ(t.createdAt, '+00:00', ?)) AS hour, COUNT(*) AS value
       FROM banktickets t
       ${clause}
      GROUP BY hour
      ORDER BY hour`,
    [TZ_OFFSET, ...params],
  ));
  return rows.map((r) => ({
    hour: Number(r.hour),
    label: `${String(r.hour).padStart(2, "0")}:00`,
    value: Number(r.value),
  }));
}

// ---- Period-over-period trend (powers the chart footers) --------------------

interface TrendRow extends RowDataPacket {
  recent: number;
  earlier: number;
}

export interface Trend {
  direction: "up" | "down" | "flat";
  pct: number; // absolute percentage change
}

/**
 * Compare the recent half of the selected range to the earlier half. Works for
 * any data/filter combination without assuming a calendar period.
 */
export async function getTrafficTrend(
  filters: AnalyticsFilters,
  principal: Principal,
): Promise<Trend> {
  const { clause, params } = buildWhere(filters, principal);
  const midExpr = `(SELECT DATE_ADD(MIN(t2.createdAt),
        INTERVAL TIMESTAMPDIFF(SECOND, MIN(t2.createdAt), MAX(t2.createdAt)) / 2 SECOND)
      FROM banktickets t2 ${clause})`;
  const rows = await cached(analyticsKey("trend", filters, principal), () =>
    qmsQuery<TrendRow>(
    `SELECT
        SUM(t.createdAt >= ${midExpr}) AS recent,
        SUM(t.createdAt <  ${midExpr}) AS earlier
       FROM banktickets t
       ${clause}`,
    // midExpr appears twice (each with its own WHERE params), then the outer WHERE.
    [...params, ...params, ...params],
  ));
  const recent = Number(rows[0]?.recent ?? 0);
  const earlier = Number(rows[0]?.earlier ?? 0);
  if (earlier === 0) return { direction: recent > 0 ? "up" : "flat", pct: recent > 0 ? 100 : 0 };
  const change = ((recent - earlier) / earlier) * 100;
  return {
    direction: change > 0.5 ? "up" : change < -0.5 ? "down" : "flat",
    pct: Math.abs(Math.round(change * 10) / 10),
  };
}

// ---- Filter options ---------------------------------------------------------

interface OptionRow extends RowDataPacket {
  id: string;
  name: string;
}

export interface FilterOptions {
  branches: { id: string; name: string }[];
  queues: { id: string; name: string }[];
  statuses: string[];
}

export async function getFilterOptions(): Promise<FilterOptions> {
  // Filter dimensions change rarely and aren't branch-scoped, so a single shared
  // key is safe; the DISTINCT-status scan in particular is worth not repeating.
  const [branches, queues, statuses] = await cached("filterOptions", () =>
    Promise.all([
      qmsQuery<OptionRow>("SELECT id, name FROM branches WHERE status = 1 ORDER BY name"),
      qmsQuery<OptionRow>("SELECT id, name FROM queues ORDER BY name"),
      qmsQuery<RowDataPacket & { ticketStatus: string }>(
        "SELECT DISTINCT ticketStatus FROM banktickets ORDER BY ticketStatus",
      ),
    ]),
  );
  return {
    branches: branches.map((b) => ({ id: b.id, name: b.name.trim() })),
    queues: queues.map((q) => ({ id: q.id, name: q.name.trim() })),
    statuses: statuses.map((s) => s.ticketStatus),
  };
}
