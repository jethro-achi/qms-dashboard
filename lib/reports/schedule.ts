// lib/reports/schedule.ts
// Report scheduling: users define recurring reports (e.g. "Monthly PDF"), a
// cron-triggered endpoint (POST /api/reports/run-due) generates any that are
// due, and the results are stored for in-app download on /reports.
//
// A schedule's report_type is also its cadence: a "monthly" schedule fires at
// the start of each month and generates the month that just ended, etc. All
// generation runs under the owning user's branch scope.
import { appQuery } from "../db";
import type { Principal, Role } from "../rbac";
import { isRole } from "../rbac";
import { assembleReport } from "./assemble";
import { renderReport, type ReportFormat } from "./format";
import { periodToRange, type PeriodType } from "./period";
import { newFileKey, writeReportFile, deleteReportFile } from "./storage";

export const REPORT_FORMATS: readonly ReportFormat[] = ["pdf", "xlsx", "csv"];

export interface Schedule {
  id: number;
  name: string;
  reportType: PeriodType;
  format: ReportFormat;
  isActive: boolean;
  nextRunAt: string;
  lastRunAt: string | null;
  createdAt: string;
}

export interface GeneratedReport {
  id: number;
  displayName: string;
  format: ReportFormat;
  periodLabel: string;
  byteSize: number;
  createdAt: string;
  scheduleName: string | null;
}

// ---- time helpers ------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, "0");

/** Local 'YYYY-MM-DD HH:MM:SS' — unambiguous for DATETIME columns on either engine. */
function sqlDt(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function toIso(v: unknown): string {
  if (v == null) return "";
  const d = v instanceof Date ? v : new Date(String(v).replace(" ", "T"));
  return isNaN(d.getTime()) ? String(v) : d.toISOString();
}

/** Start of the next period boundary strictly after `from`, for a given cadence. */
export function nextBoundaryAfter(type: PeriodType, from: Date): Date {
  switch (type) {
    case "daily": {
      const n = new Date(from.getFullYear(), from.getMonth(), from.getDate());
      n.setDate(n.getDate() + 1);
      return n;
    }
    case "monthly":
      return new Date(from.getFullYear(), from.getMonth() + 1, 1);
    case "quarterly": {
      const q = Math.floor(from.getMonth() / 3);
      return new Date(from.getFullYear(), (q + 1) * 3, 1);
    }
    case "annual":
      return new Date(from.getFullYear() + 1, 0, 1);
  }
}

/** The period value (YYYY-MM-DD / YYYY-MM / YYYY-Q# / YYYY) immediately before a boundary. */
export function periodValueBefore(type: PeriodType, boundary: Date): string {
  switch (type) {
    case "daily": {
      const d = new Date(boundary);
      d.setDate(d.getDate() - 1);
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }
    case "monthly": {
      const d = new Date(boundary.getFullYear(), boundary.getMonth() - 1, 1);
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    }
    case "quarterly": {
      const d = new Date(boundary.getFullYear(), boundary.getMonth() - 3, 1);
      return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
    }
    case "annual":
      return String(boundary.getFullYear() - 1);
  }
}

function safeName(s: string): string {
  return s.replace(/[^\w\-. ]/g, "_").slice(0, 150) || "report";
}

// ---- principal reconstruction (for background runs) --------------------------

interface UserRow {
  role: string;
  is_active: number | boolean;
}
interface BranchRow {
  branch_id: string;
}

/** Rebuild a user's Principal from the DB so a scheduled run enforces their scope. */
export async function principalForUser(userId: number): Promise<Principal | null> {
  const users = await appQuery<UserRow>(
    "SELECT role, is_active FROM app_users WHERE id = ?",
    [userId],
  );
  const u = users[0];
  if (!u || !(u.is_active === 1 || u.is_active === true) || !isRole(u.role)) return null;
  const branches = await appQuery<BranchRow>(
    "SELECT branch_id FROM app_user_branches WHERE user_id = ?",
    [userId],
  );
  return {
    userId,
    role: u.role as Role,
    allowedBranchIds: branches.map((b) => String(b.branch_id)),
  };
}

// ---- schedule CRUD -----------------------------------------------------------

interface ScheduleRow {
  id: number;
  name: string;
  report_type: string;
  format: string;
  is_active: number | boolean;
  next_run_at: unknown;
  last_run_at: unknown;
  created_at: unknown;
}

function mapSchedule(r: ScheduleRow): Schedule {
  return {
    id: Number(r.id),
    name: r.name,
    reportType: r.report_type as PeriodType,
    format: r.format as ReportFormat,
    isActive: r.is_active === 1 || r.is_active === true,
    nextRunAt: toIso(r.next_run_at),
    lastRunAt: r.last_run_at ? toIso(r.last_run_at) : null,
    createdAt: toIso(r.created_at),
  };
}

export async function listSchedules(userId: number): Promise<Schedule[]> {
  const rows = await appQuery<ScheduleRow>(
    `SELECT id, name, report_type, format, is_active, next_run_at, last_run_at, created_at
       FROM app_report_schedules WHERE user_id = ? ORDER BY created_at DESC`,
    [userId],
  );
  return rows.map(mapSchedule);
}

export interface CreateScheduleInput {
  name: string;
  reportType: PeriodType;
  format: ReportFormat;
}

export async function createSchedule(userId: number, input: CreateScheduleInput): Promise<void> {
  const next = nextBoundaryAfter(input.reportType, new Date());
  await appQuery(
    `INSERT INTO app_report_schedules (user_id, name, report_type, format, is_active, next_run_at)
     VALUES (?, ?, ?, ?, 1, ?)`,
    [userId, safeName(input.name).trim() || "Report", input.reportType, input.format, sqlDt(next)],
  );
}

export async function setScheduleActive(userId: number, id: number, active: boolean): Promise<void> {
  await appQuery(
    "UPDATE app_report_schedules SET is_active = ? WHERE id = ? AND user_id = ?",
    [active ? 1 : 0, id, userId],
  );
}

export async function deleteSchedule(userId: number, id: number): Promise<void> {
  await appQuery("DELETE FROM app_report_schedules WHERE id = ? AND user_id = ?", [id, userId]);
}

// ---- generated reports -------------------------------------------------------

interface GeneratedRow {
  id: number;
  display_name: string;
  format: string;
  period_label: string;
  byte_size: number;
  created_at: unknown;
  schedule_name: string | null;
}

export async function listGeneratedReports(userId: number, limit = 100): Promise<GeneratedReport[]> {
  const rows = await appQuery<GeneratedRow>(
    `SELECT g.id, g.display_name, g.format, g.period_label, g.byte_size, g.created_at,
            s.name AS schedule_name
       FROM app_generated_reports g
       LEFT JOIN app_report_schedules s ON s.id = g.schedule_id
      WHERE g.user_id = ?
      ORDER BY g.created_at DESC`,
    [userId],
  );
  return rows.slice(0, limit).map((r) => ({
    id: Number(r.id),
    displayName: r.display_name,
    format: r.format as ReportFormat,
    periodLabel: r.period_label,
    byteSize: Number(r.byte_size),
    createdAt: toIso(r.created_at),
    scheduleName: r.schedule_name ?? null,
  }));
}

/** Fetch a generated report's file key + display name, scoped to the owner. */
export async function getGeneratedFileMeta(
  userId: number,
  id: number,
): Promise<{ fileKey: string; displayName: string; format: ReportFormat } | null> {
  const rows = await appQuery<{ file_key: string; display_name: string; format: string }>(
    "SELECT file_key, display_name, format FROM app_generated_reports WHERE id = ? AND user_id = ?",
    [id, userId],
  );
  const r = rows[0];
  if (!r) return null;
  return { fileKey: r.file_key, displayName: r.display_name, format: r.format as ReportFormat };
}

/**
 * Assemble + render a report for (type, value) under `principal`, persist the
 * file, and record it. Returns the generated file's byte size, or null if the
 * period was invalid / produced nothing.
 */
export async function generateAndStore(args: {
  userId: number;
  scheduleId: number | null;
  principal: Principal;
  type: PeriodType;
  value: string;
  format: ReportFormat;
}): Promise<number | null> {
  const report = await assembleReport(args.type, args.value, args.principal);
  if (!report) return null;
  const buf = await renderReport(report, args.format);
  const fileKey = newFileKey(args.format);
  writeReportFile(fileKey, buf);
  const displayName = `${safeName(`${report.title} - ${report.periodLabel}`)}.${args.format}`;

  try {
    await appQuery(
      `INSERT INTO app_generated_reports
         (user_id, schedule_id, file_key, display_name, format, period_label, byte_size)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [args.userId, args.scheduleId, fileKey, displayName, args.format, report.periodLabel, buf.length],
    );
  } catch (e) {
    deleteReportFile(fileKey); // don't leave an orphan file if the row failed
    throw e;
  }
  return buf.length;
}

// ---- the cron worker ---------------------------------------------------------

/**
 * Generate every schedule whose next_run has passed. Each due schedule produces
 * the period that just completed and is advanced one cadence forward. Safe to
 * call repeatedly (idempotent per boundary) and resilient to individual
 * failures — one broken schedule never blocks the rest.
 */
export async function runDueSchedules(now = new Date()): Promise<{ due: number; generated: number; errors: number }> {
  const rows = await appQuery<ScheduleRow & { user_id: number }>(
    `SELECT id, user_id, name, report_type, format, next_run_at
       FROM app_report_schedules
      WHERE is_active = 1 AND next_run_at <= ?`,
    [sqlDt(now)],
  );

  let generated = 0;
  let errors = 0;
  for (const s of rows) {
    const type = s.report_type as PeriodType;
    const boundary = s.next_run_at instanceof Date ? s.next_run_at : new Date(String(s.next_run_at).replace(" ", "T"));
    const runFrom = isNaN(boundary.getTime()) ? now : boundary;
    try {
      const principal = await principalForUser(Number(s.user_id));
      if (!principal) {
        // Owner gone or deactivated — stop the schedule so it doesn't loop.
        await appQuery("UPDATE app_report_schedules SET is_active = 0 WHERE id = ?", [s.id]);
        continue;
      }
      const value = periodValueBefore(type, runFrom);
      if (periodToRange(type, value)) {
        const size = await generateAndStore({
          userId: Number(s.user_id),
          scheduleId: Number(s.id),
          principal,
          type,
          value,
          format: s.format as ReportFormat,
        });
        if (size !== null) generated++;
      }
    } catch {
      errors++;
    }
    // Advance one cadence regardless, so a persistently failing schedule can't
    // wedge the queue; the next boundary will be retried on the next tick.
    const next = nextBoundaryAfter(type, runFrom);
    await appQuery("UPDATE app_report_schedules SET last_run_at = ?, next_run_at = ? WHERE id = ?", [
      sqlDt(now),
      sqlDt(next),
      s.id,
    ]);
  }

  return { due: rows.length, generated, errors };
}
