// lib/reports/queries.ts — report-specific aggregates (branch-scoped via principal).
import type { RowDataPacket } from "mysql2";
import { qmsQuery } from "../db";
import type { Principal } from "../rbac";
import { buildWhere } from "../analytics/queries";
import type { AnalyticsFilters } from "../analytics/filters";
import { qmsSource } from "../analytics/source";

export async function getDataRange(principal: Principal): Promise<{ min: Date; max: Date }> {
  const w = buildWhere({}, principal);
  const { mode, tickets } = await qmsSource();
  const rows = await qmsQuery<RowDataPacket & { minC: string | null; maxC: string | null }>(
    `SELECT MIN(t.createdAt) minC, MAX(t.createdAt) maxC FROM ${tickets} t ${w.clause}`,
    w.params,
    mode,
  );
  const max = rows[0]?.maxC ? new Date(rows[0].maxC) : new Date();
  const min = rows[0]?.minC ? new Date(rows[0].minC) : new Date(max.getTime() - 365 * 864e5);
  return { min, max };
}

export interface BranchReportRow {
  label: string; total: number; served: number; noShows: number;
  avgWaitMin: number; avgServiceMin: number; slaPct: number;
}

export async function reportByBranch(
  filters: AnalyticsFilters, principal: Principal, slaWaitSeconds: number, slaServiceSeconds: number,
): Promise<BranchReportRow[]> {
  const w = buildWhere(filters, principal);
  const { mode, tickets } = await qmsSource();
  const rows = await qmsQuery<RowDataPacket & BranchReportRow>(
    `SELECT b.name label, COUNT(*) total, SUM(t.ticketStatus='Served') served,
        SUM(t.ticketStatus='Not Served') noShows,
        ROUND(AVG(t.notServedDuration)/60,1) avgWaitMin,
        ROUND(AVG(CASE WHEN t.ticketStatus='Served' THEN t.servingDuration END)/60,1) avgServiceMin,
        ROUND(100*SUM(t.ticketStatus='Served' AND t.notServedDuration<=? AND t.servingDuration<=?)/NULLIF(SUM(t.ticketStatus='Served'),0)) slaPct
       FROM ${tickets} t JOIN branches b ON b.id=t.branchId ${w.clause}
      GROUP BY b.name ORDER BY total DESC`,
    [slaWaitSeconds, slaServiceSeconds, ...w.params],
    mode,
  );
  return rows.map((r) => ({
    label: r.label.trim(), total: Number(r.total), served: Number(r.served), noShows: Number(r.noShows),
    avgWaitMin: Number(r.avgWaitMin ?? 0), avgServiceMin: Number(r.avgServiceMin ?? 0), slaPct: Number(r.slaPct ?? 0),
  }));
}

export interface ServiceReportRow { label: string; total: number; served: number; avgServiceMin: number }

export async function reportByService(filters: AnalyticsFilters, principal: Principal): Promise<ServiceReportRow[]> {
  const w = buildWhere(filters, principal);
  const { mode, tickets } = await qmsSource();
  const rows = await qmsQuery<RowDataPacket & ServiceReportRow>(
    `SELECT t.issueDescription label, COUNT(*) total, SUM(t.ticketStatus='Served') served,
        ROUND(AVG(CASE WHEN t.ticketStatus='Served' THEN t.servingDuration END)/60,1) avgServiceMin
       FROM ${tickets} t ${w.clause}
      GROUP BY t.issueDescription ORDER BY total DESC`,
    w.params,
    mode,
  );
  return rows.map((r) => ({
    label: r.label, total: Number(r.total), served: Number(r.served), avgServiceMin: Number(r.avgServiceMin ?? 0),
  }));
}
