// lib/analytics/reports.ts
// Per-page report queries. All reuse buildWhere() from queries.ts so the global
// filters and branch-scope RLS apply everywhere. Staff attribution joins
// banktickets.counterId -> counters.userId -> users.
import type { RowDataPacket } from "mysql2";
import { qmsQuery } from "../db";
import type { Principal } from "../rbac";
import type { AnalyticsFilters } from "./filters";
import { buildWhere, TZ_OFFSET } from "./queries";
import { getAppMetrics } from "../settings";
import { cached, analyticsKey } from "../cache";
import { qmsSource } from "./source";
import type { BarDatum } from "@/components/analytics/simple-bar-chart";

function withExtra(base: { clause: string; params: unknown[] }, extra: string): string {
  return base.clause ? `${base.clause} AND ${extra}` : `WHERE ${extra}`;
}

// ---- Branch Overview --------------------------------------------------------

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const WAIT_BANDS = ["0–5 min", "5–10 min", "10–20 min", "20–30 min", "30+ min"];

export interface TotalServed {
  label: string;
  total: number;
  served: number;
}

export interface BranchOverview {
  trafficByBranch: TotalServed[]; // Total + Served (grouped bars)
  busyDays: TotalServed[]; // Total + Served per weekday
  service: BarDatum[];
  wait: BarDatum[];
  waitDistribution: BarDatum[];
}

export async function getBranchOverview(filters: AnalyticsFilters, principal: Principal): Promise<BranchOverview> {
  const w = buildWhere(filters, principal);
  const { mode, tickets } = await qmsSource();
  type Row = RowDataPacket & { label: string; value: number };
  type TSRow = RowDataPacket & { label: string; total: number; served: number };

  const [traffic, service, wait, dow, waitDist] = await cached(
    analyticsKey("branchOverview", filters, principal, [TZ_OFFSET, mode]),
    () => Promise.all([
    qmsQuery<TSRow>(
      `SELECT b.name label, COUNT(*) total, SUM(t.ticketStatus='Served') served
         FROM ${tickets} t JOIN branches b ON b.id=t.branchId ${w.clause} GROUP BY b.name ORDER BY total DESC`,
      w.params,
      mode,
    ),
    qmsQuery<Row>(
      `SELECT b.name label, ROUND(AVG(CASE WHEN t.ticketStatus='Served' THEN t.servingDuration END)/60,1) value
         FROM ${tickets} t JOIN branches b ON b.id=t.branchId ${w.clause} GROUP BY b.name ORDER BY value DESC`,
      w.params,
      mode,
    ),
    qmsQuery<Row>(
      `SELECT b.name label, ROUND(AVG(t.notServedDuration)/60,1) value
         FROM ${tickets} t JOIN branches b ON b.id=t.branchId ${w.clause} GROUP BY b.name ORDER BY value DESC`,
      w.params,
      mode,
    ),
    qmsQuery<RowDataPacket & { dow: number; total: number; served: number }>(
      `SELECT DAYOFWEEK(CONVERT_TZ(t.createdAt,'+00:00',?)) dow, COUNT(*) total, SUM(t.ticketStatus='Served') served
         FROM ${tickets} t ${w.clause} GROUP BY dow`,
      [TZ_OFFSET, ...w.params],
      mode,
    ),
    qmsQuery<RowDataPacket & { band: string; value: number }>(
      `SELECT CASE
            WHEN t.notServedDuration < 300  THEN '0–5 min'
            WHEN t.notServedDuration < 600  THEN '5–10 min'
            WHEN t.notServedDuration < 1200 THEN '10–20 min'
            WHEN t.notServedDuration < 1800 THEN '20–30 min'
            ELSE '30+ min' END AS band, COUNT(*) value
         FROM ${tickets} t ${w.clause} GROUP BY band`,
      w.params,
      mode,
    ),
  ]));

  const byDow = new Map(dow.map((r) => [Number(r.dow), { total: Number(r.total), served: Number(r.served) }]));
  const busyDays = DAY_NAMES.map((label, i) => ({
    label,
    total: byDow.get(i + 1)?.total ?? 0,
    served: byDow.get(i + 1)?.served ?? 0,
  }));

  const byBand = new Map(waitDist.map((r) => [r.band, Number(r.value)]));
  const waitDistribution = WAIT_BANDS.map((label) => ({ label, value: byBand.get(label) ?? 0 }));

  const num = (rows: Row[]) => rows.map((r) => ({ label: r.label.trim(), value: Number(r.value ?? 0) }));
  return {
    trafficByBranch: traffic.map((r) => ({ label: r.label.trim(), total: Number(r.total), served: Number(r.served) })),
    busyDays,
    service: num(service),
    wait: num(wait),
    waitDistribution,
  };
}

// ---- Staff productivity / leaderboard ---------------------------------------

export interface StaffRow {
  staff: string;
  branch: string;
  served: number;
  pctSla: number;
  slaWithin: number;
  slaOutside: number;
  avgServiceMin: number;
  avgWaitMin: number;
  days: number;
}

export async function getStaffProductivity(filters: AnalyticsFilters, principal: Principal): Promise<StaffRow[]> {
  const w = buildWhere(filters, principal);
  const { slaWaitSeconds: SLA_WAIT, slaServiceSeconds: SLA_SVC } = await getAppMetrics();
  const { mode, tickets } = await qmsSource();
  const clause = withExtra(w, "t.ticketStatus='Served'");
  // Within SLA = wait AND service both within target; outside = either exceeds it.
  const met = "(t.notServedDuration <= ? AND t.servingDuration <= ?)";
  const rows = await qmsQuery<RowDataPacket & StaffRow>(
    `SELECT u.username staff, b.name branch,
        COUNT(t.id) served,
        ROUND(100 * SUM${met} / COUNT(t.id)) pctSla,
        SUM${met} slaWithin,
        SUM(NOT ${met}) slaOutside,
        ROUND(AVG(t.servingDuration)/60, 1) avgServiceMin,
        ROUND(AVG(t.notServedDuration)/60, 1) avgWaitMin,
        COUNT(DISTINCT DATE(t.createdAt)) days
       FROM ${tickets} t
       JOIN counters c ON c.id = t.counterId
       JOIN users u    ON u.id = c.userId
       JOIN branches b ON b.id = t.branchId
       ${clause}
      GROUP BY u.id, b.name
      ORDER BY served DESC`,
    [SLA_WAIT, SLA_SVC, SLA_WAIT, SLA_SVC, SLA_WAIT, SLA_SVC, ...w.params],
    mode,
  );
  return rows.map((r) => ({
    staff: r.staff,
    branch: r.branch,
    served: Number(r.served),
    pctSla: Number(r.pctSla ?? 0),
    slaWithin: Number(r.slaWithin ?? 0),
    slaOutside: Number(r.slaOutside ?? 0),
    avgServiceMin: Number(r.avgServiceMin ?? 0),
    avgWaitMin: Number(r.avgWaitMin ?? 0),
    days: Number(r.days ?? 0),
  }));
}

// ---- Exceptions (wait OR service time over the threshold, default 60 min) ----

export interface ExceptionRow {
  agent: string;
  branch: string;
  ticketNo: string;
  timeIn: string | null;
  serviceStart: string | null;
  serviceEnd: string | null;
  serviceMin: number;
  waitMin: number;
}

export async function getExceptions(
  filters: AnalyticsFilters,
  principal: Principal,
): Promise<{ rows: ExceptionRow[]; byStaff: BarDatum[]; thresholdMin: number }> {
  const w = buildWhere(filters, principal);
  const { anomalySeconds } = await getAppMetrics();
  const { mode, tickets } = await qmsSource();
  const secs = Number(anomalySeconds);
  // An exception is a ticket whose wait OR service time exceeds the threshold.
  const clause = withExtra(w, `(t.servingDuration > ${secs} OR t.notServedDuration > ${secs})`);
  const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);

  const [rows, byStaff] = await Promise.all([
    qmsQuery<RowDataPacket>(
      `SELECT COALESCE(u.username,'—') agent, b.name branch, t.ticketNo,
          t.notServedAt timeIn, t.servingAt serviceStart, t.servedAt serviceEnd,
          ROUND(t.servingDuration/60) serviceMin, ROUND(t.notServedDuration/60) waitMin
         FROM ${tickets} t
         LEFT JOIN counters c ON c.id = t.counterId
         LEFT JOIN users u    ON u.id = c.userId
         JOIN branches b ON b.id = t.branchId
         ${clause}
        ORDER BY GREATEST(t.servingDuration, t.notServedDuration) DESC`,
      w.params,
      mode,
    ),
    qmsQuery<RowDataPacket & { label: string; value: number }>(
      // Rank staff by the average magnitude of their exceptions (the longer of
      // the wait or the service on each offending ticket).
      `SELECT COALESCE(u.username,'—') label, ROUND(AVG(GREATEST(t.servingDuration, t.notServedDuration))/60) value
         FROM ${tickets} t
         LEFT JOIN counters c ON c.id = t.counterId
         LEFT JOIN users u    ON u.id = c.userId
         ${clause}
        GROUP BY u.id ORDER BY value DESC`,
      w.params,
      mode,
    ),
  ]);

  return {
    rows: rows.map((r) => ({
      agent: r.agent,
      branch: r.branch,
      ticketNo: r.ticketNo,
      timeIn: iso(r.timeIn),
      serviceStart: iso(r.serviceStart),
      serviceEnd: iso(r.serviceEnd),
      serviceMin: Number(r.serviceMin ?? 0),
      waitMin: Number(r.waitMin ?? 0),
    })),
    byStaff: byStaff.map((r) => ({ label: r.label, value: Number(r.value ?? 0) })),
    thresholdMin: Math.round(anomalySeconds / 60),
  };
}

// ---- Feedback (NPS) ---------------------------------------------------------
// 5 = promoter, 4 = passive, <=3 = detractor. NPS = (%promoters - %detractors).

export interface Feedback {
  totalRated: number;
  promoters: number;
  passives: number;
  detractors: number;
  nps: number;
  byBranch: { label: string; nps: number; ratings: number }[];
  ratingDistribution: { label: string; value: number }[];
  comments: { branch: string; comment: string; ticketNo: string; date: string | null }[];
}

export async function getFeedback(filters: AnalyticsFilters, principal: Principal): Promise<Feedback> {
  const w = buildWhere(filters, principal);
  const { mode, tickets } = await qmsSource();
  const clause = withExtra(w, "t.rating IS NOT NULL");

  const [aggRows, byBranch, dist, comments] = await Promise.all([
    qmsQuery<RowDataPacket & { totalRated: number; promoters: number; passives: number; detractors: number }>(
      `SELECT COUNT(*) totalRated, SUM(t.rating=5) promoters, SUM(t.rating=4) passives, SUM(t.rating<=3) detractors
         FROM ${tickets} t ${clause}`,
      w.params,
      mode,
    ),
    qmsQuery<RowDataPacket & { label: string; ratings: number; nps: number }>(
      `SELECT b.name label, COUNT(*) ratings,
          ROUND((SUM(t.rating=5) - SUM(t.rating<=3)) / COUNT(*) * 100) nps
         FROM ${tickets} t JOIN branches b ON b.id=t.branchId ${clause} GROUP BY b.name ORDER BY nps DESC`,
      w.params,
      mode,
    ),
    qmsQuery<RowDataPacket & { rating: number; value: number }>(
      `SELECT t.rating rating, COUNT(*) value FROM ${tickets} t ${clause} GROUP BY t.rating`,
      w.params,
      mode,
    ),
    qmsQuery<RowDataPacket & { branch: string; comment: string; ticketNo: string; date: string }>(
      `SELECT b.name branch, t.ratingComment comment, t.ticketNo, t.servedAt date
         FROM ${tickets} t JOIN branches b ON b.id=t.branchId ${clause} AND t.ratingComment IS NOT NULL
        ORDER BY t.servedAt DESC LIMIT 200`,
      w.params,
      mode,
    ),
  ]);

  const a = aggRows[0];
  const totalRated = Number(a?.totalRated ?? 0);
  const promoters = Number(a?.promoters ?? 0);
  const detractors = Number(a?.detractors ?? 0);
  const nps = totalRated > 0 ? Math.round(((promoters - detractors) / totalRated) * 100) : 0;

  const distByRating = new Map(dist.map((r) => [Number(r.rating), Number(r.value)]));
  const ratingDistribution = [1, 2, 3, 4, 5].map((n) => ({ label: `${n}★`, value: distByRating.get(n) ?? 0 }));

  return {
    totalRated,
    promoters,
    passives: Number(a?.passives ?? 0),
    detractors,
    nps,
    byBranch: byBranch.map((r) => ({ label: r.label.trim(), nps: Number(r.nps ?? 0), ratings: Number(r.ratings) })),
    ratingDistribution,
    comments: comments.map((r) => ({
      branch: r.branch.trim(),
      comment: r.comment,
      ticketNo: r.ticketNo,
      date: r.date ? new Date(r.date).toISOString() : null,
    })),
  };
}

// ---- Data Refresh -----------------------------------------------------------

export interface DataRefreshRow {
  branch: string;
  startDate: string | null;
  lastDate: string | null;
}

export async function getDataRefresh(filters: AnalyticsFilters, principal: Principal): Promise<DataRefreshRow[]> {
  const w = buildWhere(filters, principal);
  const { mode, tickets } = await qmsSource();
  const rows = await qmsQuery<RowDataPacket & { branch: string; startDate: string; lastDate: string }>(
    `SELECT b.name branch, MIN(t.createdAt) startDate, MAX(t.createdAt) lastDate
       FROM ${tickets} t JOIN branches b ON b.id=t.branchId ${w.clause} GROUP BY b.name ORDER BY b.name`,
    w.params,
    mode,
  );
  return rows.map((r) => ({
    branch: r.branch.trim(),
    startDate: r.startDate ? new Date(r.startDate).toISOString() : null,
    lastDate: r.lastDate ? new Date(r.lastDate).toISOString() : null,
  }));
}

// ---- Agent activity (login/logout + availability durations) -----------------
// The QMS `logs` table records only Login/Logout events (no break toggles), so
// "available" here means time an agent was logged in: we pair each successful
// "Teller Login"/"Dashboard login" with the next "Logout" and sum the sessions.
// "Unavailable" is the idle time *between* sessions within the agent's observed
// span (first event → last event) — i.e. gaps when they were logged out but
// still around that day. Both are reported over the last 30 days of activity.

export interface AgentAvail {
  agent: string;
  availableMin: number; // logged-in minutes (summed login→logout sessions)
  unavailableMin: number; // idle minutes between sessions in the observed span
  sessions: number;
  lastSeen: string | null;
}

export interface AgentActivity {
  logins: number;
  totalAgents: number;
  activeStaff: number;
  inactiveStaff: number;
  availability: AgentAvail[];
  logs: { date: string; agent: string; action: string; details: string }[];
}

interface SessionEventRow extends RowDataPacket {
  uid: string | null;
  agent: string;
  action: string;
  createdAt: string | Date;
}

const isLoginAction = (a: string) => a === "Teller Login" || a === "Dashboard login";

/** Pair login/logout events per agent into available + unavailable minutes. */
function computeAvailability(rows: SessionEventRow[]): AgentAvail[] {
  const byAgent = new Map<string, { name: string; events: { t: number; login: boolean }[] }>();
  for (const r of rows) {
    if (!r.uid) continue; // system events have no agent to attribute to
    const t = new Date(r.createdAt).getTime();
    if (isNaN(t)) continue;
    const g = byAgent.get(r.uid) ?? { name: r.agent, events: [] };
    g.events.push({ t, login: isLoginAction(r.action) });
    byAgent.set(r.uid, g);
  }

  const out: AgentAvail[] = [];
  for (const { name, events } of byAgent.values()) {
    events.sort((a, b) => a.t - b.t);
    const first = events[0].t;
    const last = events[events.length - 1].t;
    let availableMs = 0;
    let sessions = 0;
    let openLogin: number | null = null;
    for (const e of events) {
      if (e.login) {
        if (openLogin === null) openLogin = e.t; // start a session (ignore re-login)
      } else if (openLogin !== null) {
        availableMs += e.t - openLogin; // close the session on logout
        sessions += 1;
        openLogin = null;
      }
    }
    // Still logged in at the end of the window → count up to their last event.
    if (openLogin !== null && last > openLogin) {
      availableMs += last - openLogin;
      sessions += 1;
    }
    const spanMs = Math.max(0, last - first);
    const availableMin = Math.round(availableMs / 60000);
    const unavailableMin = Math.max(0, Math.round((spanMs - availableMs) / 60000));
    out.push({ agent: name, availableMin, unavailableMin, sessions, lastSeen: new Date(last).toISOString() });
  }
  // Most active first.
  out.sort((a, b) => b.availableMin - a.availableMin);
  return out;
}

export async function getAgentActivity(): Promise<AgentActivity> {
  // NOTE: In "new" mode the QMS records agent availability in `audit_logs`
  // (before/after JSON), not this `logs` table — porting that is a follow-up.
  // For now these run against the active mode's database.
  const { mode } = await qmsSource();
  const [loginRows, totalRows, counterRows, sessionRows, logRows] = await Promise.all([
    qmsQuery<RowDataPacket & { n: number }>(
      "SELECT COUNT(*) n FROM logs WHERE details LIKE 'success%' AND action IN ('Teller Login','Dashboard login')",
      [],
      mode,
    ),
    qmsQuery<RowDataPacket & { n: number }>("SELECT COUNT(DISTINCT userId) n FROM counters", [], mode),
    qmsQuery<RowDataPacket & { available: number; agents: number }>(
      "SELECT available, COUNT(DISTINCT userId) agents FROM counters GROUP BY available",
      [],
      mode,
    ),
    // Successful login/logout events over the last 30 days of activity, for pairing.
    qmsQuery<SessionEventRow>(
      `SELECT l.userId uid, COALESCE(u.username,'—') agent, l.action, l.createdAt
         FROM logs l LEFT JOIN users u ON u.id = l.userId
        WHERE l.details LIKE 'success%'
          AND l.action IN ('Teller Login','Dashboard login','Logout')
          AND l.createdAt >= (SELECT DATE_SUB(MAX(createdAt), INTERVAL 30 DAY) FROM logs)
        ORDER BY l.userId, l.createdAt`,
      [],
      mode,
    ),
    qmsQuery<RowDataPacket & { createdAt: string; agent: string; action: string; details: string }>(
      `SELECT l.createdAt, COALESCE(u.username,'system') agent, l.action, l.details
         FROM logs l LEFT JOIN users u ON u.id = l.userId
        ORDER BY l.createdAt DESC LIMIT 200`,
      [],
      mode,
    ),
  ]);
  const active = counterRows.find((r) => Number(r.available) === 1)?.agents ?? 0;
  const inactive = counterRows.find((r) => Number(r.available) === 0)?.agents ?? 0;
  return {
    logins: Number(loginRows[0]?.n ?? 0),
    totalAgents: Number(totalRows[0]?.n ?? 0),
    activeStaff: Number(active),
    inactiveStaff: Number(inactive),
    availability: computeAvailability(sessionRows),
    logs: logRows.map((r) => ({
      date: new Date(r.createdAt).toISOString(),
      agent: r.agent,
      action: r.action,
      details: r.details,
    })),
  };
}
