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
import { qmsSource } from "./source";

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
  if (filters.serviceNames?.length) conds.push(inList("t.issueDescription", filters.serviceNames, params));
  if (filters.staffIds?.length) {
    // Staff -> tickets goes through the counter the ticket was served at.
    const ph = filters.staffIds.map(() => "?").join(", ");
    conds.push(`t.counterId IN (SELECT id FROM counters WHERE userId IN (${ph}))`);
    params.push(...filters.staffIds);
  }

  if (filters.today) {
    // Today mode overrides any date range: scope to the current calendar day.
    const today = new Date().toISOString().slice(0, 10);
    conds.push("t.createdAt >= ?");
    params.push(`${today} 00:00:00`);
    conds.push("t.createdAt < DATE_ADD(?, INTERVAL 1 DAY)");
    params.push(`${today} 00:00:00`);
  } else {
    if (filters.dateFrom) {
      conds.push("t.createdAt >= ?");
      params.push(`${filters.dateFrom} 00:00:00`);
    }
    if (filters.dateTo) {
      // inclusive of the whole end day
      conds.push("t.createdAt < DATE_ADD(?, INTERVAL 1 DAY)");
      params.push(`${filters.dateTo} 00:00:00`);
    }
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
  const { slaWaitSeconds, slaServiceSeconds } = await getAppMetrics();
  const { mode, tickets } = await qmsSource();
  // SLA is met only when BOTH the wait and the service time are within target.
  const rows = await cached(analyticsKey("kpis", filters, principal, [slaWaitSeconds, slaServiceSeconds, mode]), () =>
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
        SUM(CASE WHEN t.ticketStatus = 'Served' AND t.notServedDuration <= ? AND t.servingDuration <= ? THEN 1 ELSE 0 END) AS withinSla,
        SUM(t.rating IS NOT NULL)                                         AS ratedCount,
        AVG(t.rating)                                                     AS avgRating,
        MIN(t.createdAt)                                                  AS minCreated,
        MAX(t.createdAt)                                                  AS maxCreated
       FROM ${tickets} t
       ${clause}`,
    [slaWaitSeconds, slaServiceSeconds, ...params],
    mode,
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
  const { mode, tickets } = await qmsSource();
  const rows = await cached(analyticsKey("drivers", filters, principal, [Number(limit), mode]), () =>
    qmsQuery<DriverRow>(
    `SELECT t.issueDescription AS label, COUNT(*) AS value
       FROM ${tickets} t
       ${clause}
      GROUP BY t.issueDescription
      ORDER BY value DESC
      LIMIT ${Number(limit)}`,
    params,
    mode,
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
  const { mode, tickets } = await qmsSource();
  // Convert stored UTC to the configured local zone before bucketing by hour.
  const rows = await cached(analyticsKey("hourly", filters, principal, [TZ_OFFSET, mode]), () =>
    qmsQuery<HourRow>(
    `SELECT HOUR(CONVERT_TZ(t.createdAt, '+00:00', ?)) AS hour, COUNT(*) AS value
       FROM ${tickets} t
       ${clause}
      GROUP BY hour
      ORDER BY hour`,
    [TZ_OFFSET, ...params],
    mode,
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
  const { mode, tickets } = await qmsSource();
  const midExpr = `(SELECT DATE_ADD(MIN(t2.createdAt),
        INTERVAL TIMESTAMPDIFF(SECOND, MIN(t2.createdAt), MAX(t2.createdAt)) / 2 SECOND)
      FROM ${tickets} t2 ${clause})`;
  const rows = await cached(analyticsKey("trend", filters, principal, [mode]), () =>
    qmsQuery<TrendRow>(
    `SELECT
        SUM(t.createdAt >= ${midExpr}) AS recent,
        SUM(t.createdAt <  ${midExpr}) AS earlier
       FROM ${tickets} t
       ${clause}`,
    // midExpr appears twice (each with its own WHERE params), then the outer WHERE.
    [...params, ...params, ...params],
    mode,
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
  services: string[];
  staff: { id: string; name: string }[];
}

export async function getFilterOptions(): Promise<FilterOptions> {
  const { mode, tickets } = await qmsSource();
  // Filter dimensions change rarely and aren't branch-scoped, so a mode-scoped
  // shared key is safe; the DISTINCT scans in particular are worth not repeating.
  const [branches, queues, statuses, services, staff] = await cached(`filterOptions:${mode}`, () =>
    Promise.all([
      qmsQuery<OptionRow>("SELECT id, name FROM branches WHERE status = 1 ORDER BY name", [], mode),
      qmsQuery<OptionRow>("SELECT id, name FROM queues ORDER BY name", [], mode),
      qmsQuery<RowDataPacket & { ticketStatus: string }>(
        `SELECT DISTINCT ticketStatus FROM ${tickets} t ORDER BY ticketStatus`,
        [],
        mode,
      ),
      qmsQuery<RowDataPacket & { s: string }>(
        `SELECT DISTINCT issueDescription AS s FROM ${tickets} t WHERE issueDescription IS NOT NULL AND issueDescription <> '' ORDER BY issueDescription`,
        [],
        mode,
      ),
      qmsQuery<OptionRow>(
        "SELECT DISTINCT u.id, COALESCE(u.username, '—') AS name FROM users u JOIN counters c ON c.userId = u.id ORDER BY name",
        [],
        mode,
      ),
    ]),
  );
  return {
    branches: branches.map((b) => ({ id: b.id, name: b.name.trim() })),
    queues: queues.map((q) => ({ id: q.id, name: q.name.trim() })),
    statuses: statuses.map((s) => s.ticketStatus),
    services: services.map((r) => r.s.trim()).filter(Boolean),
    staff: staff.map((u) => ({ id: String(u.id), name: String(u.name).trim() })),
  };
}
