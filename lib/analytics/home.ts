// lib/analytics/home.ts
// Home-page specifics: the 6 headline KPIs (each with a period-over-period
// trend badge) and the total-traffic time series for the area chart.
import type { RowDataPacket } from "mysql2";
import { qmsQuery } from "../db";
import type { Principal } from "../rbac";
import type { AnalyticsFilters } from "./filters";
import { buildWhere, TZ_OFFSET } from "./queries";
import { getAppMetrics } from "../settings";
import { cached, analyticsKey } from "../cache";

export interface HomeKpi {
  key: string;
  label: string;
  value: string;
  // Primary trend = month-over-month (last ~30 days vs the 30 days before).
  deltaPct: number;
  deltaLabel: string; // "+12%", "-8%", "0%", or "—" (no reliable baseline)
  direction: "up" | "down" | "flat";
  good: boolean; // true = moved in the desirable direction (green), else red
  // Secondary trend = day-over-day (latest data day vs the day before).
  dayDeltaLabel: string;
  dayDirection: "up" | "down" | "flat";
  dayGood: boolean;
  footerStrong: string;
}

interface TrendResult {
  deltaPct: number;
  deltaLabel: string;
  direction: "up" | "down" | "flat";
  good: boolean;
}

/**
 * Trend of `now` vs `prev`, expressed as an IMPROVEMENT so the badge reads
 * consistently: up/green = better, down/red = worse — regardless of whether the
 * raw metric rose or fell (a falling wait time is an improvement).
 *
 *  - `prevSample` is the number of tickets backing the baseline; below
 *    `minSample` the comparison isn't trustworthy (a handful of tickets makes a
 *    ratio explode), so we show a neutral "—" instead of a garbage percentage.
 *  - Rounded to a whole number and the display is capped at ±300% (shown as
 *    "300%+"), so a genuine but extreme move stays readable instead of a
 *    four-digit figure.
 *  - `flat` is a real state (|change| ≤ 1%), so the text can say "steady".
 */
export function trend(now: number, prev: number, higherBetter: boolean, prevSample: number, minSample: number): TrendResult {
  const flat: TrendResult = { deltaPct: 0, deltaLabel: "0%", direction: "flat", good: true };
  const none: TrendResult = { deltaPct: 0, deltaLabel: "—", direction: "flat", good: true };

  if (prevSample < minSample || prev <= 0) return none; // no trustworthy baseline

  const raw = ((now - prev) / prev) * 100;
  const improvement = higherBetter ? raw : -raw;
  const direction = improvement > 1 ? "up" : improvement < -1 ? "down" : "flat";
  if (direction === "flat") return flat;
  const rounded = Math.round(improvement);
  const capped = Math.max(-300, Math.min(300, rounded));
  const over = Math.abs(rounded) > 300;
  return {
    deltaPct: rounded,
    deltaLabel: `${capped > 0 ? "+" : ""}${capped}%${over ? "+" : ""}`,
    direction,
    good: direction !== "down",
  };
}

const min1 = (sec: number | null) => Math.round(((sec ?? 0) / 60) * 10) / 10;
const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);

const sqlDt = (d: Date) => d.toISOString().slice(0, 19).replace("T", " "); // 'YYYY-MM-DD HH:MM:SS' UTC

interface ValuesRow extends RowDataPacket {
  served: number; noShows: number;
  waitAll: number | null; svcAll: number | null;
  slaWithinAll: number; servedForSla: number;
  ratAll: number | null; rated: number;
  maxC: string | null;
}
type WindowRow = RowDataPacket & Record<string, number | null>;

export async function getHomeKpis(filters: AnalyticsFilters, principal: Principal): Promise<HomeKpi[]> {
  const w = buildWhere(filters, principal);
  const { slaSeconds: SLA_SECONDS } = await getAppMetrics();
  const slaMin = Math.round(SLA_SECONDS / 60);

  // --- Card VALUES: reflect the FULL active filter (date + branch/queue/status).
  const valRows = await cached(analyticsKey("home.values", filters, principal, [SLA_SECONDS]), () =>
    qmsQuery<ValuesRow>(
    `SELECT
        SUM(t.ticketStatus='Served')                                      AS served,
        SUM(t.ticketStatus='Not Served')                                  AS noShows,
        AVG(t.notServedDuration)                                          AS waitAll,
        AVG(CASE WHEN t.ticketStatus='Served' THEN t.servingDuration END) AS svcAll,
        SUM(t.ticketStatus='Served' AND t.notServedDuration<=${SLA_SECONDS}) AS slaWithinAll,
        SUM(t.ticketStatus='Served')                                      AS servedForSla,
        AVG(t.rating)                                                     AS ratAll,
        SUM(t.rating IS NOT NULL)                                         AS rated,
        MAX(t.createdAt)                                                  AS maxC
       FROM banktickets t ${w.clause}`,
    w.params,
  ));
  const r = valRows[0];

  const served = Number(r?.served ?? 0);
  const noShows = Number(r?.noShows ?? 0);
  const slaAll = pct(Number(r?.slaWithinAll ?? 0), Number(r?.servedForSla ?? 0));
  const rated = Number(r?.rated ?? 0);
  const avgRating = Math.round(Number(r?.ratAll ?? 0) * 10) / 10;

  // --- Trend WINDOWS: anchored to the latest day in the filtered data (so they
  // work even when the data lags "today"), scoped by the SAME branch/queue/status
  // filter but NOT clipped by the date filter (the windows define their own dates).
  const sw = buildWhere(
    { branchIds: filters.branchIds, queueIds: filters.queueIds, statuses: filters.statuses },
    principal,
  );

  let win: WindowRow | undefined;
  const anchor = r?.maxC ? new Date(r.maxC) : null;
  if (anchor) {
    const dayStart = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate()));
    const dayEnd = new Date(dayStart); dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
    const prevDayStart = new Date(dayStart); prevDayStart.setUTCDate(prevDayStart.getUTCDate() - 1);
    const monNowStart = new Date(dayEnd); monNowStart.setUTCDate(monNowStart.getUTCDate() - 30);
    const monPrevStart = new Date(monNowStart); monPrevStart.setUTCDate(monPrevStart.getUTCDate() - 30);

    const between = (a: Date, b: Date) => `(t.createdAt >= '${sqlDt(a)}' AND t.createdAt < '${sqlDt(b)}')`;
    const windows: Record<string, string> = {
      dN: between(dayStart, dayEnd),     // latest day
      dP: between(prevDayStart, dayStart), // day before
      mN: between(monNowStart, dayEnd),  // last 30 days
      mP: between(monPrevStart, monNowStart), // prior 30 days
    };
    const cols: string[] = [];
    for (const [k, wp] of Object.entries(windows)) {
      cols.push(`SUM(${wp}) cnt_${k}`);
      cols.push(`SUM(${wp} AND t.ticketStatus='Served') served_${k}`);
      cols.push(`SUM(${wp} AND t.ticketStatus='Not Served') noshow_${k}`);
      cols.push(`AVG(CASE WHEN ${wp} THEN t.notServedDuration END) wait_${k}`);
      cols.push(`AVG(CASE WHEN ${wp} AND t.ticketStatus='Served' THEN t.servingDuration END) svc_${k}`);
      cols.push(`SUM(${wp} AND t.ticketStatus='Served' AND t.notServedDuration<=${SLA_SECONDS}) slaw_${k}`);
      cols.push(`SUM(${wp} AND t.rating IS NOT NULL) rated_${k}`);
      cols.push(`AVG(CASE WHEN ${wp} THEN t.rating END) rat_${k}`);
    }
    const swFilters = { branchIds: filters.branchIds, queueIds: filters.queueIds, statuses: filters.statuses };
    const winRows = await cached(
      analyticsKey("home.windows", swFilters, principal, [SLA_SECONDS, r?.maxC ? String(r.maxC) : "none"]),
      () => qmsQuery<WindowRow>(`SELECT ${cols.join(", ")} FROM banktickets t ${sw.clause}`, sw.params),
    );
    win = winRows[0];
  }

  const g = (name: string) => Number(win?.[name] ?? 0);
  const slaWin = (k: string) => pct(g(`slaw_${k}`), g(`served_${k}`));

  // A window needs at least this many tickets in the baseline for a % to mean
  // anything; below it we show "—". The month window is wider so it needs more.
  const MIN_MONTH = 20;
  const MIN_DAY = 8;

  // Two trends per metric — month-over-month (primary) + day-over-day (secondary)
  // — each gated by the number of tickets backing the baseline window.
  const t2 = (
    now: (k: string) => number,
    sample: (k: string) => number,
    higherBetter: boolean,
  ) => ({
    m: trend(now("mN"), now("mP"), higherBetter, sample("mP"), MIN_MONTH),
    d: trend(now("dN"), now("dP"), higherBetter, sample("dP"), MIN_DAY),
  });

  const cnt = (k: string) => g(`cnt_${k}`);
  const tServed = t2((k) => g(`served_${k}`), (k) => g(`served_${k}`), true);
  const tNoShow = t2((k) => g(`noshow_${k}`), cnt, false);
  const tWait = t2((k) => g(`wait_${k}`), cnt, false);
  const tSvc = t2((k) => g(`svc_${k}`), (k) => g(`served_${k}`), false);
  const tSla = t2(slaWin, (k) => g(`served_${k}`), true);
  const tRating = t2((k) => g(`rat_${k}`), (k) => g(`rated_${k}`), true);

  const mk = (
    key: string, label: string, value: string,
    t: { m: TrendResult; d: TrendResult },
    texts: { up: string; flat: string; down: string },
  ): HomeKpi => ({
    key, label, value,
    deltaPct: t.m.deltaPct, deltaLabel: t.m.deltaLabel, direction: t.m.direction, good: t.m.good,
    dayDeltaLabel: t.d.deltaLabel, dayDirection: t.d.direction, dayGood: t.d.good,
    footerStrong: texts[t.m.direction],
  });

  return [
    mk("served", "Customers Served", served.toLocaleString(), tServed,
      { up: "Throughput improving", flat: "Throughput steady", down: "Throughput slowing" }),
    mk("sla", "Served Within SLA", `${slaAll}%`, tSla,
      { up: "SLA compliance rising", flat: `Holding the ${slaMin}-min SLA`, down: "SLA slipping" }),
    mk("wait", "Avg Waiting Time", `${min1(r?.waitAll)} min`, tWait,
      { up: "Queues moving faster", flat: "Wait times steady", down: "Waits getting longer" }),
    mk("service", "Avg Service Time", `${min1(r?.svcAll)} min`, tSvc,
      { up: "Faster service delivery", flat: "Service time steady", down: "Service slowing down" }),
    mk("noshow", "No Shows", noShows.toLocaleString(), tNoShow,
      { up: "Fewer abandoned tickets", flat: "No-shows steady", down: "More no-shows" }),
    mk("rating", "Satisfaction", rated ? `${avgRating}/5` : "—", tRating,
      { up: "Happier customers", flat: "Sentiment steady", down: "Sentiment dipping" }),
  ];
}

// ---- Total traffic time series (area chart) ---------------------------------

export interface TrafficPoint {
  date: string; // YYYY-MM-DD
  total: number;
  served: number;
}

export async function getTrafficSeries(filters: AnalyticsFilters, principal: Principal): Promise<TrafficPoint[]> {
  const w = buildWhere(filters, principal);
  const rows = await cached(analyticsKey("home.series", filters, principal, [TZ_OFFSET]), () =>
    qmsQuery<RowDataPacket & { d: string; total: number; served: number }>(
    `SELECT DATE_FORMAT(CONVERT_TZ(t.createdAt,'+00:00',?), '%Y-%m-%d') d,
            COUNT(*) total, SUM(t.ticketStatus='Served') served
       FROM banktickets t ${w.clause}
      GROUP BY d ORDER BY d`,
    [TZ_OFFSET, ...w.params],
  ));
  return rows.map((x) => ({ date: String(x.d), total: Number(x.total), served: Number(x.served) }));
}
