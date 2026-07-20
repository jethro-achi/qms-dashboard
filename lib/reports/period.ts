// lib/reports/period.ts
// Report period handling: turn a (type, value) into an inclusive date range +
// human labels, and enumerate the selectable periods that actually contain data.
export type PeriodType = "daily" | "monthly" | "quarterly" | "annual";
export const PERIOD_TYPES: readonly PeriodType[] = ["daily", "monthly", "quarterly", "annual"];

export interface PeriodOption {
  value: string;
  label: string;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const pad = (n: number) => String(n).padStart(2, "0");
const lastDay = (year: number, month0: number) => new Date(year, month0 + 1, 0).getDate();

export interface Range {
  dateFrom: string; // YYYY-MM-DD inclusive
  dateTo: string; // YYYY-MM-DD inclusive
  label: string;
}

/** Convert a period value to an inclusive date range + label. Returns null if invalid. */
export function periodToRange(type: PeriodType, value: string): Range | null {
  if (type === "daily") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const d = new Date(`${value}T00:00:00`);
    const label = d.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
    return { dateFrom: value, dateTo: value, label };
  }
  if (type === "monthly") {
    const m = /^(\d{4})-(\d{2})$/.exec(value);
    if (!m) return null;
    const y = Number(m[1]), mo = Number(m[2]);
    if (mo < 1 || mo > 12) return null;
    return {
      dateFrom: `${y}-${pad(mo)}-01`,
      dateTo: `${y}-${pad(mo)}-${pad(lastDay(y, mo - 1))}`,
      label: `${MONTHS[mo - 1]} ${y}`,
    };
  }
  if (type === "quarterly") {
    const m = /^(\d{4})-Q([1-4])$/.exec(value);
    if (!m) return null;
    const y = Number(m[1]), q = Number(m[2]);
    const startMonth = (q - 1) * 3 + 1;
    const endMonth = startMonth + 2;
    return {
      dateFrom: `${y}-${pad(startMonth)}-01`,
      dateTo: `${y}-${pad(endMonth)}-${pad(lastDay(y, endMonth - 1))}`,
      label: `Q${q} ${y}`,
    };
  }
  // annual
  if (!/^\d{4}$/.test(value)) return null;
  return { dateFrom: `${value}-01-01`, dateTo: `${value}-12-31`, label: value };
}

// ---- custom (arbitrary from–to) range ---------------------------------------
// Custom ranges are for ON-DEMAND reports only — never a recurring schedule
// cadence (a fixed span can't repeat). Encoded as "YYYY-MM-DD..YYYY-MM-DD".
export type ReportRangeType = PeriodType | "custom";

// Cap the span so a single report can't scan an unbounded slice of the fact
// table (a year is plenty for an operational report).
const MAX_CUSTOM_DAYS = 366;

/** Build the on-wire value for a custom range. */
export function customValue(from: string, to: string): string {
  return `${from}..${to}`;
}

/** Parse + validate a "YYYY-MM-DD..YYYY-MM-DD" custom range. null if invalid. */
export function parseCustomRange(value: string): Range | null {
  const m = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(value);
  if (!m) return null;
  const [, from, to] = m;
  const df = new Date(`${from}T00:00:00`);
  const dt = new Date(`${to}T00:00:00`);
  if (isNaN(df.getTime()) || isNaN(dt.getTime()) || df > dt) return null;
  const span = Math.round((dt.getTime() - df.getTime()) / 86_400_000) + 1;
  if (span > MAX_CUSTOM_DAYS) return null;
  const fmt = (d: Date) => d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  return { dateFrom: from, dateTo: to, label: `${fmt(df)} – ${fmt(dt)}` };
}

/** Resolve any report range type (the 4 cadences + custom) to a date range. */
export function resolveReportRange(type: ReportRangeType, value: string): Range | null {
  return type === "custom" ? parseCustomRange(value) : periodToRange(type, value);
}

/** Enumerate the periods (newest first) between two dates, per type. */
export function listPeriods(min: Date, max: Date): Record<PeriodType, PeriodOption[]> {
  const daily: PeriodOption[] = [];
  for (let d = new Date(max); d >= min && daily.length < 90; d.setDate(d.getDate() - 1)) {
    const v = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    daily.push({ value: v, label: new Date(`${v}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) });
  }

  const monthly: PeriodOption[] = [];
  {
    let y = max.getFullYear(), mo = max.getMonth();
    const stopY = min.getFullYear(), stopMo = min.getMonth();
    while (y > stopY || (y === stopY && mo >= stopMo)) {
      monthly.push({ value: `${y}-${pad(mo + 1)}`, label: `${MONTHS[mo]} ${y}` });
      mo--;
      if (mo < 0) { mo = 11; y--; }
    }
  }

  const quarterly: PeriodOption[] = [];
  {
    let y = max.getFullYear(), q = Math.floor(max.getMonth() / 3) + 1;
    const stopY = min.getFullYear(), stopQ = Math.floor(min.getMonth() / 3) + 1;
    while (y > stopY || (y === stopY && q >= stopQ)) {
      quarterly.push({ value: `${y}-Q${q}`, label: `Q${q} ${y}` });
      q--;
      if (q < 1) { q = 4; y--; }
    }
  }

  const annual: PeriodOption[] = [];
  for (let y = max.getFullYear(); y >= min.getFullYear(); y--) {
    annual.push({ value: String(y), label: String(y) });
  }

  return { daily, monthly, quarterly, annual };
}
