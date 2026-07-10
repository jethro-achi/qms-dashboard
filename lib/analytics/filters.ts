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
});

export type AnalyticsFilters = z.infer<typeof AnalyticsFiltersSchema>;

export const EMPTY_FILTERS: AnalyticsFilters = {};

/** Parse a raw cookie value into validated filters (empty on anything invalid). */
export function parseFilters(raw: string | undefined | null): AnalyticsFilters {
  if (!raw) return EMPTY_FILTERS;
  try {
    const parsed = AnalyticsFiltersSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : EMPTY_FILTERS;
  } catch {
    return EMPTY_FILTERS;
  }
}

export function hasActiveFilters(f: AnalyticsFilters): boolean {
  return Boolean(
    f.dateFrom ||
      f.dateTo ||
      (f.branchIds && f.branchIds.length) ||
      (f.queueIds && f.queueIds.length) ||
      (f.statuses && f.statuses.length),
  );
}
