// lib/reports/assemble.ts
// Build a generic report model (KPIs + tables) for a period + branch scope.
// The CSV / Excel / PDF formatters all consume this same structure.
import type { Principal } from "../rbac";
import { seesAllBranches } from "../rbac";
import { getAppMetrics } from "../settings";
import { getKpis, getHourlyTraffic, getFilterOptions } from "../analytics/queries";
import { getTrafficSeries } from "../analytics/home";
import { getStaffProductivity, getFeedback } from "../analytics/reports";
import { resolveReportRange, type ReportRangeType } from "./period";
import { reportByBranch, reportByService } from "./queries";

export interface ReportTable {
  title: string;
  columns: { key: string; header: string }[];
  rows: Array<Record<string, string | number>>;
}
export interface ReportData {
  title: string;
  periodLabel: string;
  range: { dateFrom: string; dateTo: string };
  generatedAt: string;
  scopeLabel: string;
  kpis: { label: string; value: string }[];
  tables: ReportTable[];
}

export async function assembleReport(
  type: ReportRangeType,
  value: string,
  principal: Principal,
): Promise<ReportData | null> {
  const range = resolveReportRange(type, value);
  if (!range) return null;
  const filters = { dateFrom: range.dateFrom, dateTo: range.dateTo };
  const { slaWaitSeconds, slaServiceSeconds } = await getAppMetrics();

  const [kpis, feedback, byBranch, byService, staff, hourly, daily, options] = await Promise.all([
    getKpis(filters, principal),
    getFeedback(filters, principal),
    reportByBranch(filters, principal, slaWaitSeconds, slaServiceSeconds),
    reportByService(filters, principal),
    getStaffProductivity(filters, principal),
    getHourlyTraffic(filters, principal),
    getTrafficSeries(filters, principal),
    getFilterOptions(),
  ]);

  const scopeLabel = seesAllBranches(principal.role)
    ? "All branches"
    : principal.allowedBranchIds
        .map((id) => options.branches.find((b) => b.id === id)?.name ?? id)
        .join(", ") || "No branches assigned";

  const typeLabel =
    { daily: "Daily", monthly: "Monthly", quarterly: "Quarterly", annual: "Annual", custom: "Custom" }[type];

  const kpiList = [
    { label: "Total Traffic", value: kpis.totalTraffic.toLocaleString() },
    { label: "Customers Served", value: `${kpis.served.toLocaleString()} (${kpis.servedPct}%)` },
    { label: "No Shows", value: `${kpis.noShows.toLocaleString()} (${kpis.noShowPct}%)` },
    { label: "Avg Waiting Time", value: `${kpis.avgWaitMin} min` },
    { label: "Avg Service Time", value: `${kpis.avgServiceMin} min` },
    { label: "Served Within SLA", value: `${kpis.slaPct}%` },
    { label: "Avg Total Time", value: `${kpis.avgTotalMin} min` },
    { label: "Net Promoter Score", value: feedback.totalRated ? String(feedback.nps) : "—" },
    { label: "Total Ratings", value: String(feedback.totalRated) },
  ];

  const tables: ReportTable[] = [
    {
      title: "By Branch",
      columns: [
        { key: "label", header: "Branch" },
        { key: "total", header: "Total" },
        { key: "served", header: "Served" },
        { key: "noShows", header: "No Shows" },
        { key: "avgWaitMin", header: "Avg Wait (min)" },
        { key: "avgServiceMin", header: "Avg Service (min)" },
        { key: "slaPct", header: "% Within SLA" },
      ],
      rows: byBranch.map((r) => ({ ...r })),
    },
    {
      title: "By Service",
      columns: [
        { key: "label", header: "Service" },
        { key: "total", header: "Total" },
        { key: "served", header: "Served" },
        { key: "avgServiceMin", header: "Avg Service (min)" },
      ],
      rows: byService.map((r) => ({ ...r })),
    },
  ];

  if (staff.length) {
    tables.push({
      title: "Staff Performance",
      columns: [
        { key: "staff", header: "Staff" },
        { key: "branch", header: "Branch" },
        { key: "served", header: "Customers Served" },
        { key: "pctSla", header: "% Within SLA" },
        { key: "avgServiceMin", header: "Avg Service (min)" },
        { key: "avgWaitMin", header: "Avg Wait (min)" },
      ],
      rows: staff.map((s) => ({
        staff: s.staff, branch: s.branch, served: s.served, pctSla: `${s.pctSla}%`,
        avgServiceMin: s.avgServiceMin, avgWaitMin: s.avgWaitMin,
      })),
    });
  }

  if (type !== "daily" && daily.length > 1) {
    tables.push({
      title: "Daily Trend",
      columns: [
        { key: "date", header: "Date" },
        { key: "total", header: "Total" },
        { key: "served", header: "Served" },
      ],
      rows: daily.map((d) => ({ date: d.date, total: d.total, served: d.served })),
    });
  }

  if (hourly.length) {
    tables.push({
      title: "Hourly Distribution",
      columns: [
        { key: "label", header: "Hour" },
        { key: "value", header: "Tickets" },
      ],
      rows: hourly.map((h) => ({ label: h.label, value: h.value })),
    });
  }

  return {
    title: `${typeLabel} Queue Management Report`,
    periodLabel: range.label,
    range: { dateFrom: range.dateFrom, dateTo: range.dateTo },
    generatedAt: new Date().toISOString(),
    scopeLabel,
    kpis: kpiList,
    tables,
  };
}
