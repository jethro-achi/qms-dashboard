// lib/analytics/breakdown.ts
// -----------------------------------------------------------------------------
// Generic, RLS-safe "drill down by dimension" aggregation over the QMS fact
// table. A visual asks for ONE metric grouped by ANY dimension (branch, service,
// queue, agent, status), optionally narrowed by a drill path (the categories the
// user has clicked into). Everything runs through buildWhere(), so a branch-
// scoped user can never see rows outside their branches and a drill can only ever
// narrow the set, never widen it. Raw ticket rows never leave the server — only
// the aggregated {label, value} bars do.
// -----------------------------------------------------------------------------
import type { RowDataPacket } from "mysql2";
import { qmsQuery } from "../db";
import type { Principal } from "../rbac";
import { buildWhere } from "./queries";
import type { AnalyticsFilters } from "./filters";
import { qmsSource } from "./source";
import { getAppMetrics } from "../settings";
import { cached, analyticsKey } from "../cache";
import type {
  BreakdownMetric, BreakdownDimension, BreakdownRow, DrillStep,
} from "./breakdown-shared";

// Re-export the client-safe constants + types so existing server-side importers
// (route handlers, pages) can keep importing them from "./breakdown". The values
// themselves live in ./breakdown-shared, which pulls in no DB code — that split
// keeps the database layer out of the browser bundle for the client drill-down.
export {
  DIMENSION_LABELS, DRILL_ORDER, METRIC_HIGHER_BETTER,
} from "./breakdown-shared";
export type {
  BreakdownMetric, BreakdownDimension, BreakdownRow, DrillStep,
} from "./breakdown-shared";

// Per-dimension SQL: the join needed, the group key (a stable id used to drill),
// the display label, and the GROUP BY. All fragments are constants — never user
// input — so interpolating them is safe; values still bind as parameters.
interface DimSpec { join: string; keyExpr: string; labelExpr: string; groupBy: string }
const DIMENSIONS: Record<BreakdownDimension, DimSpec> = {
  branch: { join: "JOIN branches b ON b.id = t.branchId", keyExpr: "t.branchId", labelExpr: "b.name", groupBy: "t.branchId, b.name" },
  queue:  { join: "JOIN queues q ON q.id = t.queueId", keyExpr: "t.queueId", labelExpr: "q.name", groupBy: "t.queueId, q.name" },
  service:{ join: "", keyExpr: "t.issueDescription", labelExpr: "t.issueDescription", groupBy: "t.issueDescription" },
  status: { join: "", keyExpr: "t.ticketStatus", labelExpr: "t.ticketStatus", groupBy: "t.ticketStatus" },
  agent:  {
    join: "LEFT JOIN counters c ON c.id = t.counterId LEFT JOIN users u ON u.id = c.userId",
    keyExpr: "u.id", labelExpr: "COALESCE(u.username, 'Unknown')", groupBy: "u.id, u.username",
  },
};

function metricSql(metric: BreakdownMetric): { sql: string; slaParams: boolean } {
  switch (metric) {
    case "traffic":    return { sql: "COUNT(*)", slaParams: false };
    case "served":     return { sql: "SUM(t.ticketStatus='Served')", slaParams: false };
    case "noShows":    return { sql: "SUM(t.ticketStatus='Not Served')", slaParams: false };
    case "avgWait":    return { sql: "ROUND(AVG(t.notServedDuration)/60, 1)", slaParams: false };
    case "avgService": return { sql: "ROUND(AVG(CASE WHEN t.ticketStatus='Served' THEN t.servingDuration END)/60, 1)", slaParams: false };
    case "slaPct":     return { sql: "ROUND(100*SUM(t.ticketStatus='Served' AND t.notServedDuration<=? AND t.servingDuration<=?)/NULLIF(SUM(t.ticketStatus='Served'),0))", slaParams: true };
    case "avgRating":  return { sql: "ROUND(AVG(t.rating), 2)", slaParams: false };
  }
}

// Fold one drill step into the filter set — reusing the exact same filter
// dimensions the global filter bar uses, so RLS + validation are shared.
function applyDrill(f: AnalyticsFilters, step: DrillStep): AnalyticsFilters {
  const add = (arr: string[] | undefined) => [...(arr ?? []), step.key];
  switch (step.dimension) {
    case "branch":  return { ...f, branchIds: add(f.branchIds) };
    case "queue":   return { ...f, queueIds: add(f.queueIds) };
    case "service": return { ...f, serviceNames: add(f.serviceNames) };
    case "status":  return { ...f, statuses: add(f.statuses) };
    case "agent":   return { ...f, staffIds: add(f.staffIds) };
  }
}

export async function getBreakdown(args: {
  metric: BreakdownMetric;
  dimension: BreakdownDimension;
  drill?: DrillStep[];
  filters: AnalyticsFilters;
  principal: Principal;
}): Promise<BreakdownRow[]> {
  const drill = args.drill ?? [];
  let filters = args.filters;
  for (const step of drill) filters = applyDrill(filters, step);

  const w = buildWhere(filters, args.principal);
  const { mode, tickets } = await qmsSource();
  const dim = DIMENSIONS[args.dimension];
  const met = metricSql(args.metric);
  const { slaWaitSeconds, slaServiceSeconds } = await getAppMetrics();
  const preParams = met.slaParams ? [slaWaitSeconds, slaServiceSeconds] : [];

  const rows = await cached(
    analyticsKey("breakdown", filters, args.principal, [
      args.metric, args.dimension, mode, drill.map((d) => `${d.dimension}:${d.key}`).join("|"),
    ]),
    () =>
      qmsQuery<RowDataPacket & { gkey: string | null; glabel: string | null; value: number | null }>(
        `SELECT ${dim.keyExpr} AS gkey, ${dim.labelExpr} AS glabel, ${met.sql} AS value
           FROM ${tickets} t ${dim.join} ${w.clause}
          GROUP BY ${dim.groupBy}
          ORDER BY value DESC
          LIMIT 50`,
        [...preParams, ...w.params],
        mode,
      ),
  );
  return rows
    .map((r) => ({
      key: r.gkey == null ? "" : String(r.gkey),
      label: (r.glabel == null ? "" : String(r.glabel)).trim() || "Unknown",
      value: Number(r.value ?? 0),
    }))
    // Drop null-key groups (e.g. tickets with no agent/branch) — they can't be
    // drilled into and would clutter the chart.
    .filter((r) => r.key !== "");
}
