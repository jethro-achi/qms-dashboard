// lib/reports/schedule.ts
// Report scheduling: users define recurring reports (e.g. "Monthly PDF"), a
// cron-triggered endpoint (POST /api/reports/run-due) generates any that are
// due, and the results are stored for in-app download on /reports.
//
// A schedule's report_type is also its cadence: a "monthly" schedule fires at
// the start of each month and generates the month that just ended, etc. All
// generation runs under the owning user's branch scope.
import { appQuery, appTransaction } from "../db";
import type { TxContext } from "../db-adapters";
import type { Principal, Role } from "../rbac";
import { isRole, roleDescription, ROLE_LABELS } from "../rbac";
import { ensureAppMigrations } from "../migrate";
import { assembleReport, type ReportData } from "./assemble";
import { renderReport, MIME, type ReportFormat } from "./format";
import { periodToRange, type PeriodType } from "./period";
import { newFileKey, writeReportFile, deleteReportFile } from "./storage";
import { isMailConfigured, sendMail, normalizeEmails } from "./mailer";
import { composeReportEmail, firstName, greetingFromEmail } from "./email-report";
import { audit } from "../audit";

export const REPORT_FORMATS: readonly ReportFormat[] = ["pdf", "xlsx", "csv"];

export interface Recipient {
  id: number;
  name: string;
  email?: string;
}

export interface Schedule {
  id: number;
  name: string;
  reportType: PeriodType;
  format: ReportFormat;
  isActive: boolean;
  // Per-cadence run timing (all local time).
  runHour: number;
  runMinute: number;
  dayOfMonth: number;
  monthOfYear: number;
  recipients: Recipient[];
  /** External email addresses this schedule also emails the report to. */
  emailRecipients: string[];
  /** Optional free-text intro included in the delivery email body. */
  emailNote: string | null;
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
  /** True when this report was shared TO the caller (they don't own it). */
  shared: boolean;
  /** Owner's name, shown for shared reports. */
  ownerName: string | null;
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

// ---- per-cadence run timing --------------------------------------------------
// The schedule's cadence still decides WHICH period it generates (the one that
// just ended, via periodValueBefore). These fields decide only WHEN it runs.

export interface ScheduleTiming {
  runHour: number; // 0–23
  runMinute: number; // 0–59
  dayOfMonth: number; // 1–31 (monthly & quarterly; clamped to the month length)
  monthOfYear: number; // 1–12 (annual only)
}

export const DEFAULT_TIMING: ScheduleTiming = { runHour: 6, runMinute: 0, dayOfMonth: 1, monthOfYear: 1 };

const clampInt = (n: unknown, lo: number, hi: number, dflt: number) => {
  const v = Math.floor(Number(n));
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt;
};

export function normalizeTiming(t: Partial<ScheduleTiming> | undefined): ScheduleTiming {
  return {
    runHour: clampInt(t?.runHour, 0, 23, DEFAULT_TIMING.runHour),
    runMinute: clampInt(t?.runMinute, 0, 59, DEFAULT_TIMING.runMinute),
    dayOfMonth: clampInt(t?.dayOfMonth, 1, 31, DEFAULT_TIMING.dayOfMonth),
    monthOfYear: clampInt(t?.monthOfYear, 1, 12, DEFAULT_TIMING.monthOfYear),
  };
}

const lastDayOfMonth = (year: number, month0: number) => new Date(year, month0 + 1, 0).getDate();
const clampDom = (year: number, month0: number, dom: number) => Math.min(dom, lastDayOfMonth(year, month0));

/**
 * The next run datetime strictly after `from`, honouring the cadence + timing.
 *   daily     — every day at run_hour:run_minute
 *   monthly   — day_of_month each month at the time
 *   quarterly — day_of_month of the first month of each quarter (Jan/Apr/Jul/Oct)
 *   annual    — month_of_year + day_of_month each year at the time
 */
export function computeNextRun(type: PeriodType, timing: ScheduleTiming, from: Date): Date {
  const t = normalizeTiming(timing);
  const at = (y: number, m0: number, d: number) => new Date(y, m0, d, t.runHour, t.runMinute, 0, 0);

  if (type === "daily") {
    let r = at(from.getFullYear(), from.getMonth(), from.getDate());
    if (r <= from) r = at(from.getFullYear(), from.getMonth(), from.getDate() + 1);
    return r;
  }
  if (type === "monthly") {
    let y = from.getFullYear();
    let mo = from.getMonth();
    let r = at(y, mo, clampDom(y, mo, t.dayOfMonth));
    if (r <= from) {
      mo += 1;
      if (mo > 11) { mo = 0; y += 1; }
      r = at(y, mo, clampDom(y, mo, t.dayOfMonth));
    }
    return r;
  }
  if (type === "quarterly") {
    const y = from.getFullYear();
    const candidates: Date[] = [];
    for (const yy of [y, y + 1]) for (const mm of [0, 3, 6, 9]) candidates.push(at(yy, mm, clampDom(yy, mm, t.dayOfMonth)));
    return candidates.find((c) => c > from) ?? candidates[candidates.length - 1];
  }
  // annual
  const mm = t.monthOfYear - 1;
  const y = from.getFullYear();
  let r = at(y, mm, clampDom(y, mm, t.dayOfMonth));
  if (r <= from) r = at(y + 1, mm, clampDom(y + 1, mm, t.dayOfMonth));
  return r;
}

// ---- recipients (admins only; RBAC enforced) ---------------------------------
// Both BRANCH_OPS and ADMIN may only send to ADMINs; the super admin has no
// Reports section at all. So the allowable recipient set is simply "active
// admins" (minus the caller).

interface AdminRow {
  id: number;
  full_name: string;
  email: string;
}

export async function listAdminRecipients(excludeUserId: number): Promise<Recipient[]> {
  await ensureAppMigrations();
  const rows = await appQuery<AdminRow>(
    "SELECT id, full_name, email FROM app_users WHERE role = 'ADMIN' AND is_active = 1 ORDER BY full_name",
  );
  return rows
    .filter((r) => Number(r.id) !== excludeUserId)
    .map((r) => ({ id: Number(r.id), name: r.full_name, email: r.email }));
}

/** Keep only the ids that are active admins — the RBAC gate for any recipient set. */
async function adminIdsAmong(ids: number[]): Promise<number[]> {
  const clean = [...new Set(ids.map((n) => Math.floor(Number(n))).filter((n) => Number.isInteger(n) && n > 0))];
  if (clean.length === 0) return [];
  const placeholders = clean.map(() => "?").join(", ");
  const rows = await appQuery<{ id: number }>(
    `SELECT id FROM app_users WHERE role = 'ADMIN' AND is_active = 1 AND id IN (${placeholders})`,
    clean,
  );
  return rows.map((r) => Number(r.id));
}

/** Dialect-aware last-insert id, valid within the same transaction/connection. */
async function lastInsertId(tx: TxContext): Promise<number> {
  const rows =
    tx.dialect === "mssql"
      ? await tx.query<{ id: number }>("SELECT CAST(SCOPE_IDENTITY() AS BIGINT) AS id")
      : await tx.query<{ id: number }>("SELECT LAST_INSERT_ID() AS id");
  return Number(rows[0]?.id);
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
  run_hour: number;
  run_minute: number;
  day_of_month: number;
  month_of_year: number;
  email_note: string | null;
  next_run_at: unknown;
  last_run_at: unknown;
  created_at: unknown;
}

function mapSchedule(r: ScheduleRow, recipients: Recipient[], emailRecipients: string[]): Schedule {
  return {
    id: Number(r.id),
    name: r.name,
    reportType: r.report_type as PeriodType,
    format: r.format as ReportFormat,
    isActive: r.is_active === 1 || r.is_active === true,
    runHour: Number(r.run_hour ?? 6),
    runMinute: Number(r.run_minute ?? 0),
    dayOfMonth: Number(r.day_of_month ?? 1),
    monthOfYear: Number(r.month_of_year ?? 1),
    recipients,
    emailRecipients,
    emailNote: r.email_note ?? null,
    nextRunAt: toIso(r.next_run_at),
    lastRunAt: r.last_run_at ? toIso(r.last_run_at) : null,
    createdAt: toIso(r.created_at),
  };
}

export async function listSchedules(userId: number): Promise<Schedule[]> {
  await ensureAppMigrations();
  const rows = await appQuery<ScheduleRow>(
    `SELECT id, name, report_type, format, is_active,
            run_hour, run_minute, day_of_month, month_of_year, email_note,
            next_run_at, last_run_at, created_at
       FROM app_report_schedules WHERE user_id = ? ORDER BY created_at DESC`,
    [userId],
  );
  // Fetch every recipient for this user's schedules in one query, then group.
  const recRows = await appQuery<{ schedule_id: number; user_id: number; full_name: string; email: string }>(
    `SELECT rr.schedule_id, rr.user_id, u.full_name, u.email
       FROM app_report_recipients rr
       JOIN app_users u ON u.id = rr.user_id
      WHERE rr.schedule_id IN (SELECT id FROM app_report_schedules WHERE user_id = ?)`,
    [userId],
  );
  const bySchedule = new Map<number, Recipient[]>();
  for (const r of recRows) {
    const list = bySchedule.get(Number(r.schedule_id)) ?? [];
    list.push({ id: Number(r.user_id), name: r.full_name, email: r.email });
    bySchedule.set(Number(r.schedule_id), list);
  }
  // External email recipients, grouped the same way.
  const emailRows = await appQuery<{ schedule_id: number; email: string }>(
    `SELECT schedule_id, email FROM app_report_email_recipients
      WHERE schedule_id IN (SELECT id FROM app_report_schedules WHERE user_id = ?)`,
    [userId],
  );
  const emailsBySchedule = new Map<number, string[]>();
  for (const r of emailRows) {
    const list = emailsBySchedule.get(Number(r.schedule_id)) ?? [];
    list.push(r.email);
    emailsBySchedule.set(Number(r.schedule_id), list);
  }
  return rows.map((r) =>
    mapSchedule(r, bySchedule.get(Number(r.id)) ?? [], emailsBySchedule.get(Number(r.id)) ?? []),
  );
}

export interface CreateScheduleInput {
  name: string;
  reportType: PeriodType;
  format: ReportFormat;
  timing?: Partial<ScheduleTiming>;
  recipientIds?: number[];
  /** External email addresses to send the report to (validated + de-duped). */
  emailRecipients?: string[];
  /** Optional free-text intro line included in the delivery email. */
  emailNote?: string | null;
}

export async function createSchedule(userId: number, input: CreateScheduleInput): Promise<void> {
  await ensureAppMigrations();
  const timing = normalizeTiming(input.timing);
  const next = computeNextRun(input.reportType, timing, new Date());
  const recipientIds = await adminIdsAmong(input.recipientIds ?? []); // RBAC: admins only
  const emails = normalizeEmails(input.emailRecipients ?? []).slice(0, 50);
  const note = (input.emailNote ?? "").trim().slice(0, 1000) || null;
  await appTransaction(async (tx) => {
    await tx.query(
      `INSERT INTO app_report_schedules
         (user_id, name, report_type, format, is_active, run_hour, run_minute, day_of_month, month_of_year, email_note, next_run_at)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
      [
        userId, safeName(input.name).trim() || "Report", input.reportType, input.format,
        timing.runHour, timing.runMinute, timing.dayOfMonth, timing.monthOfYear, note, sqlDt(next),
      ],
    );
    const id = await lastInsertId(tx);
    for (const rid of recipientIds) {
      await tx.query("INSERT INTO app_report_recipients (schedule_id, user_id) VALUES (?, ?)", [id, rid]);
    }
    for (const email of emails) {
      await tx.query("INSERT INTO app_report_email_recipients (schedule_id, email) VALUES (?, ?)", [id, email]);
    }
  });
}

/**
 * Edit an existing schedule the caller owns: name, cadence, format, timing,
 * recipients (internal + external), and the email note. Recipients are fully
 * replaced with the given sets. next_run_at is recomputed from the new cadence/
 * timing; is_active is left untouched. Returns false if the caller doesn't own it.
 */
export async function updateSchedule(userId: number, id: number, input: CreateScheduleInput): Promise<boolean> {
  await ensureAppMigrations();
  const owns = await appQuery<{ id: number }>(
    "SELECT id FROM app_report_schedules WHERE id = ? AND user_id = ?",
    [id, userId],
  );
  if (owns.length === 0) return false;

  const timing = normalizeTiming(input.timing);
  const next = computeNextRun(input.reportType, timing, new Date());
  const recipientIds = await adminIdsAmong(input.recipientIds ?? []); // RBAC: admins only
  const emails = normalizeEmails(input.emailRecipients ?? []).slice(0, 50);
  const note = (input.emailNote ?? "").trim().slice(0, 1000) || null;

  await appTransaction(async (tx) => {
    await tx.query(
      `UPDATE app_report_schedules
          SET name = ?, report_type = ?, format = ?, run_hour = ?, run_minute = ?,
              day_of_month = ?, month_of_year = ?, email_note = ?, next_run_at = ?
        WHERE id = ? AND user_id = ?`,
      [
        safeName(input.name).trim() || "Report", input.reportType, input.format,
        timing.runHour, timing.runMinute, timing.dayOfMonth, timing.monthOfYear, note, sqlDt(next),
        id, userId,
      ],
    );
    // Replace recipient sets wholesale.
    await tx.query("DELETE FROM app_report_recipients WHERE schedule_id = ?", [id]);
    for (const rid of recipientIds) {
      await tx.query("INSERT INTO app_report_recipients (schedule_id, user_id) VALUES (?, ?)", [id, rid]);
    }
    await tx.query("DELETE FROM app_report_email_recipients WHERE schedule_id = ?", [id]);
    for (const email of emails) {
      await tx.query("INSERT INTO app_report_email_recipients (schedule_id, email) VALUES (?, ?)", [id, email]);
    }
  });
  return true;
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
  owner_id: number;
  owner_name: string | null;
}

export async function listGeneratedReports(userId: number, limit = 100): Promise<GeneratedReport[]> {
  await ensureAppMigrations();
  // The caller sees reports they OWN plus any shared TO them.
  const rows = await appQuery<GeneratedRow>(
    `SELECT g.id, g.display_name, g.format, g.period_label, g.byte_size, g.created_at,
            s.name AS schedule_name, g.user_id AS owner_id, ou.full_name AS owner_name
       FROM app_generated_reports g
       LEFT JOIN app_report_schedules s ON s.id = g.schedule_id
       LEFT JOIN app_users ou ON ou.id = g.user_id
      WHERE g.user_id = ?
         OR g.id IN (SELECT report_id FROM app_report_shares WHERE user_id = ?)
      ORDER BY g.created_at DESC`,
    [userId, userId],
  );
  return rows.slice(0, limit).map((r) => ({
    id: Number(r.id),
    displayName: r.display_name,
    format: r.format as ReportFormat,
    periodLabel: r.period_label,
    byteSize: Number(r.byte_size),
    createdAt: toIso(r.created_at),
    scheduleName: r.schedule_name ?? null,
    shared: Number(r.owner_id) !== userId,
    ownerName: r.owner_name ?? null,
  }));
}

/** Fetch a generated report's file meta if the caller owns OR was shared it. */
export async function getGeneratedFileMeta(
  userId: number,
  id: number,
): Promise<{ fileKey: string; displayName: string; format: ReportFormat } | null> {
  await ensureAppMigrations();
  const rows = await appQuery<{ file_key: string; display_name: string; format: string }>(
    `SELECT file_key, display_name, format FROM app_generated_reports
      WHERE id = ?
        AND (user_id = ? OR id IN (SELECT report_id FROM app_report_shares WHERE user_id = ?))`,
    [id, userId, userId],
  );
  const r = rows[0];
  if (!r) return null;
  return { fileKey: r.file_key, displayName: r.display_name, format: r.format as ReportFormat };
}

/**
 * Manually share a report the caller owns with a set of ADMIN recipients.
 * Recipients that aren't active admins are dropped (RBAC); duplicates are
 * ignored. Throws if the caller doesn't own the report.
 */
export async function shareReport(userId: number, reportId: number, recipientIds: number[]): Promise<number> {
  await ensureAppMigrations();
  const owns = await appQuery<{ id: number }>(
    "SELECT id FROM app_generated_reports WHERE id = ? AND user_id = ?",
    [reportId, userId],
  );
  if (owns.length === 0) throw new Error("Report not found or not owned by you.");

  const admins = await adminIdsAmong(recipientIds);
  let added = 0;
  for (const rid of admins) {
    const exists = await appQuery<{ report_id: number }>(
      "SELECT report_id FROM app_report_shares WHERE report_id = ? AND user_id = ?",
      [reportId, rid],
    );
    if (exists.length === 0) {
      await appQuery("INSERT INTO app_report_shares (report_id, user_id) VALUES (?, ?)", [reportId, rid]);
      added += 1;
    }
  }
  return added;
}

export interface GenerateResult {
  size: number;
  reportId: number;
  /** Number of addresses the report was emailed to (0 if email is off/none). */
  emailed: number;
  /** Set when email was attempted but failed — the report is still stored. */
  emailError?: string;
}

/**
 * Email a freshly-generated report to a schedule's recipients (external
 * addresses + the internal app-users). Best-effort: never throws — email is
 * additive to the always-succeeding in-app delivery. Returns how many addresses
 * were reached (0 = email off or no recipients) and any error to surface.
 */
async function deliverReportEmail(args: {
  scheduleId: number;
  ownerUserId: number;
  ownerRole: Role;
  report: ReportData;
  buffer: Buffer;
  format: ReportFormat;
  displayName: string;
}): Promise<{ emailed: number; error?: string }> {
  if (!isMailConfigured()) return { emailed: 0 };
  try {
    const [extRows, intRows, ownerRows, schedRows] = await Promise.all([
      appQuery<{ email: string }>(
        "SELECT email FROM app_report_email_recipients WHERE schedule_id = ?",
        [args.scheduleId],
      ),
      appQuery<{ email: string; full_name: string }>(
        `SELECT u.email, u.full_name FROM app_report_recipients rr
           JOIN app_users u ON u.id = rr.user_id
          WHERE rr.schedule_id = ?`,
        [args.scheduleId],
      ),
      appQuery<{ full_name: string; email: string }>(
        "SELECT full_name, email FROM app_users WHERE id = ?",
        [args.ownerUserId],
      ),
      appQuery<{ email_note: string | null }>(
        "SELECT email_note FROM app_report_schedules WHERE id = ?",
        [args.scheduleId],
      ),
    ]);

    // Map each recipient address to a greeting name. Internal app-users use their
    // system first name; external addresses derive one from the local-part. A
    // system name wins if the same address is in both lists.
    const nameByEmail = new Map<string, string>();
    for (const r of extRows) {
      const [e] = normalizeEmails([r.email]);
      if (e && !nameByEmail.has(e)) nameByEmail.set(e, greetingFromEmail(e));
    }
    for (const r of intRows) {
      const [e] = normalizeEmails([r.email]);
      if (e) nameByEmail.set(e, firstName(r.full_name) || greetingFromEmail(e));
    }
    if (nameByEmail.size === 0) return { emailed: 0 };

    // Replies go to the schedule OWNER, not the shared service mailbox. From
    // stays as SMTP_FROM (kept aligned with SPF/DKIM for deliverability); only
    // Reply-To carries the person, with their name for a friendly reply header.
    const ownerName = ownerRows[0]?.full_name ?? "";
    const ownerEmail = (ownerRows[0]?.email ?? "").trim();
    const replyTo =
      normalizeEmails([ownerEmail]).length > 0
        ? ownerName
          ? `${ownerName} <${ownerEmail}>`
          : ownerEmail
        : undefined;

    const base = {
      reportTitle: args.report.title,
      periodLabel: args.report.periodLabel,
      scopeLabel: args.report.scopeLabel,
      senderName: ownerRows[0]?.full_name ?? "QMS Analytics Dashboard",
      // Role rendered as the app shows it, e.g. "Nakawa Branch Operations".
      senderRole: roleDescription(args.ownerRole, args.report.scopeLabel) ?? ROLE_LABELS[args.ownerRole],
      format: args.format,
      note: schedRows[0]?.email_note ?? null,
    };
    const attachment = { filename: args.displayName, content: args.buffer, contentType: MIME[args.format] };

    // One email per recipient, so each gets a personalised "Dear {name}," greeting
    // and recipients never see each other's addresses. A bad address doesn't stop
    // the rest.
    let emailed = 0;
    let firstErr: string | undefined;
    for (const [email, name] of nameByEmail) {
      const composed = composeReportEmail({ ...base, recipientName: name });
      try {
        await sendMail({
          to: [email],
          subject: composed.subject,
          text: composed.text,
          html: composed.html,
          replyTo,
          attachments: [attachment],
        });
        emailed += 1;
      } catch (e) {
        if (!firstErr) firstErr = (e as Error).message;
      }
    }

    // Audit the batch: who sent what to how many recipients (count only — no
    // addresses — to keep PII out of the trail).
    if (emailed > 0) {
      await audit({
        userId: args.ownerUserId,
        action: "REPORT_EMAIL",
        resource: `schedule:${args.scheduleId}`,
        details: { recipients: emailed, period: args.report.periodLabel, format: args.format },
        ip: null,
        userAgent: null,
      }).catch(() => { /* audit must never break delivery */ });
    }
    return { emailed, error: emailed === 0 ? firstErr : undefined };
  } catch (e) {
    return { emailed: 0, error: (e as Error).message };
  }
}

/**
 * Assemble + render a report for (type, value) under `principal`, persist the
 * file, record it, share it in-app, and — for a scheduled run with email
 * configured — email it to the schedule's recipients. Returns the stored size,
 * the new report id, and how many addresses were emailed; null if the period was
 * invalid / produced nothing. Emailing never fails the generation.
 */
export async function generateAndStore(args: {
  userId: number;
  scheduleId: number | null;
  principal: Principal;
  type: PeriodType;
  value: string;
  format: ReportFormat;
}): Promise<GenerateResult | null> {
  const report = await assembleReport(args.type, args.value, args.principal);
  if (!report) return null;
  const buf = await renderReport(report, args.format);
  const fileKey = newFileKey(args.format);
  writeReportFile(fileKey, buf);
  const displayName = `${safeName(`${report.title} - ${report.periodLabel}`)}.${args.format}`;

  let reportId = 0;
  try {
    await appTransaction(async (tx) => {
      await tx.query(
        `INSERT INTO app_generated_reports
           (user_id, schedule_id, file_key, display_name, format, period_label, byte_size)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [args.userId, args.scheduleId, fileKey, displayName, args.format, report.periodLabel, buf.length],
      );
      // Auto-deliver: a scheduled run is shared with the schedule's recipients so
      // it shows up in their download list too. file_key is unique, so we can
      // resolve the new row's id without relying on last-insert semantics.
      if (args.scheduleId != null) {
        const idRows = await tx.query<{ id: number }>(
          "SELECT id FROM app_generated_reports WHERE file_key = ?",
          [fileKey],
        );
        reportId = Number(idRows[0]?.id);
        const recs = await tx.query<{ user_id: number }>(
          "SELECT user_id FROM app_report_recipients WHERE schedule_id = ?",
          [args.scheduleId],
        );
        for (const r of recs) {
          await tx.query("INSERT INTO app_report_shares (report_id, user_id) VALUES (?, ?)", [reportId, Number(r.user_id)]);
        }
      }
    });
  } catch (e) {
    deleteReportFile(fileKey); // don't leave an orphan file if the row failed
    throw e;
  }

  // Email delivery happens AFTER the row is committed, so a mail-server hiccup
  // can never roll back a successfully generated + stored report.
  let emailed = 0;
  let emailError: string | undefined;
  if (args.scheduleId != null) {
    const res = await deliverReportEmail({
      scheduleId: args.scheduleId,
      ownerUserId: args.userId,
      ownerRole: args.principal.role,
      report,
      buffer: buf,
      format: args.format,
      displayName,
    });
    emailed = res.emailed;
    emailError = res.error;
  }

  return { size: buf.length, reportId, emailed, emailError };
}

/**
 * Generate + deliver a schedule's report RIGHT NOW (the "Send now / test"
 * action), using the most recently completed period for its cadence — the same
 * period the next scheduled tick would produce. Ownership-checked. Does NOT
 * advance next_run_at (this is out-of-band from the cron cadence).
 */
export interface RunNowResult {
  ok: boolean;
  error?: string;
  periodLabel?: string;
  emailed?: number;
  emailConfigured?: boolean;
  emailError?: string;
}

export async function runScheduleNow(
  userId: number,
  scheduleId: number,
  now = new Date(),
): Promise<RunNowResult> {
  await ensureAppMigrations();
  const rows = await appQuery<{ id: number; report_type: string; format: string }>(
    "SELECT id, report_type, format FROM app_report_schedules WHERE id = ? AND user_id = ?",
    [scheduleId, userId],
  );
  const s = rows[0];
  if (!s) return { ok: false, error: "Schedule not found." };

  const principal = await principalForUser(userId);
  if (!principal) return { ok: false, error: "Your account is not active." };

  const type = s.report_type as PeriodType;
  const value = periodValueBefore(type, now);
  const range = periodToRange(type, value);
  if (!range) return { ok: false, error: "No completed period to generate yet." };

  const result = await generateAndStore({
    userId,
    scheduleId: Number(s.id),
    principal,
    type,
    value,
    format: s.format as ReportFormat,
  });
  if (!result) return { ok: false, error: `No data for ${range.label}, so the report was empty.` };

  return {
    ok: true,
    periodLabel: range.label,
    emailed: result.emailed,
    emailConfigured: isMailConfigured(),
    emailError: result.emailError,
  };
}

// ---- the cron worker ---------------------------------------------------------

/**
 * Generate every schedule whose next_run has passed. Each due schedule produces
 * the period that just completed and is advanced one cadence forward. Safe to
 * call repeatedly (idempotent per boundary) and resilient to individual
 * failures — one broken schedule never blocks the rest.
 */
export async function runDueSchedules(now = new Date()): Promise<{ due: number; generated: number; errors: number }> {
  await ensureAppMigrations();
  const rows = await appQuery<ScheduleRow & { user_id: number }>(
    `SELECT id, user_id, name, report_type, format,
            run_hour, run_minute, day_of_month, month_of_year, next_run_at
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
        const result = await generateAndStore({
          userId: Number(s.user_id),
          scheduleId: Number(s.id),
          principal,
          type,
          value,
          format: s.format as ReportFormat,
        });
        if (result !== null) generated++;
      }
    } catch {
      errors++;
    }
    // Advance to the next scheduled run regardless, so a persistently failing
    // schedule can't wedge the queue; the next run will be retried on its tick.
    const timing: ScheduleTiming = {
      runHour: Number(s.run_hour ?? 6),
      runMinute: Number(s.run_minute ?? 0),
      dayOfMonth: Number(s.day_of_month ?? 1),
      monthOfYear: Number(s.month_of_year ?? 1),
    };
    const next = computeNextRun(type, timing, runFrom);
    await appQuery("UPDATE app_report_schedules SET last_run_at = ?, next_run_at = ? WHERE id = ?", [
      sqlDt(now),
      sqlDt(next),
      s.id,
    ]);
  }

  return { due: rows.length, generated, errors };
}
