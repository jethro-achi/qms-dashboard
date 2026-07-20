// lib/analytics/filters.ts
// Global analytics filters, persisted in a cookie so they apply across every
// page until the user edits or clears them. The cookie is written client-side
// by the filter bar and read server-side (here) when running queries.
import { z } from "zod";

export const FILTER_COOKIE = "qms_filters";

export const AnalyticsFiltersSchema = z.object({
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  branchIds: z.array(z.string().min(1)).optional(),
  queueIds: z.array(z.string().min(1)).optional(),
  statuses: z.array(z.string().min(1)).optional(),
  // Wave A: filter by service (banktickets.issueDescription) and by staff
  // member (user ids, resolved to banktickets via the counter join).
  serviceNames: z.array(z.string().min(1)).optional(),
  staffIds: z.array(z.string().min(1)).optional(),
  // "Show today's data" mode. When true it overrides any date range and scopes
  // every query to the current day; an explicit date range turns it back off.
  today: z.boolean().optional(),
});

export type AnalyticsFilters = z.infer<typeof AnalyticsFiltersSchema>;

export const EMPTY_FILTERS: AnalyticsFilters = {};

/**
 * Default look-back window (days) applied when the user hasn't picked a date
 * range. On a bank with millions of tickets an unbounded default makes every
 * dashboard load full-scan the fact table; a bounded default keeps the common
 * case cheap (and, with the (branchId, createdAt) index, fast) while the user
 * can always widen the range via the filter bar.
 *
 *   0 (or unset) = all history (previous behaviour — safe for small datasets).
 *   30 / 90      = recommended for high-volume production QMS databases.
 *
 * Anchored to "now"; if your QMS data lags real time by more than this window
 * the dashboard will look empty until you widen the filter — tune accordingly.
 */
export const DEFAULT_LOOKBACK_DAYS = Math.max(0, Number(process.env.QMS_DEFAULT_LOOKBACK_DAYS ?? 0));

/** Apply the default look-back window when no explicit date filter is set. */
export function withDefaultWindow(f: AnalyticsFilters): AnalyticsFilters {
  if (DEFAULT_LOOKBACK_DAYS <= 0) return f;
  if (f.dateFrom || f.dateTo) return f; // the user has chosen a range — respect it
  const from = new Date();
  from.setUTCDate(from.getUTCDate() - DEFAULT_LOOKBACK_DAYS);
  return { ...f, dateFrom: from.toISOString().slice(0, 10) };
}

/**
 * Parse a raw cookie value into validated filters (empty on anything invalid),
 * then apply the default look-back window. Freshness/data-range probes that must
 * see ALL history call the query layer with EMPTY_FILTERS/{} directly and so
 * bypass this default.
 */
export function parseFilters(raw: string | undefined | null): AnalyticsFilters {
  if (!raw) return withDefaultWindow(EMPTY_FILTERS);
  try {
    const parsed = AnalyticsFiltersSchema.safeParse(JSON.parse(raw));
    return withDefaultWindow(parsed.success ? parsed.data : EMPTY_FILTERS);
  } catch {
    return withDefaultWindow(EMPTY_FILTERS);
  }
}

export function hasActiveFilters(f: AnalyticsFilters): boolean {
  return Boolean(
    f.dateFrom ||
      f.dateTo ||
      (f.branchIds && f.branchIds.length) ||
      (f.queueIds && f.queueIds.length) ||
      (f.statuses && f.statuses.length) ||
      (f.serviceNames && f.serviceNames.length) ||
      (f.staffIds && f.staffIds.length),
  );
}

/**
 * Resolve the effective "today" mode for a request.
 *
 * The app-wide "Default to today's data" setting is only a PER-USER DEFAULT — the
 * starting value for someone who has never touched the toggle. It is NOT a force:
 * each user's own choice (persisted per-browser in the filter cookie) always wins,
 * so one user's — or the super admin's — preference never locks anyone else. The
 * toggle stays visible for everyone, which is what makes the override possible.
 *
 *  - An explicit date range means the user wants history, so it wins outright.
 *  - Otherwise: the user's own `today` (if they've chosen) wins; if they haven't,
 *    fall back to the app-wide default.
 */
export function withTodayResolved(f: AnalyticsFilters, defaultToday: boolean): AnalyticsFilters {
  const explicitRange = Boolean(f.dateFrom || f.dateTo);
  if (explicitRange) return { ...f, today: false };
  const today = f.today ?? defaultToday;
  return { ...f, today };
}
