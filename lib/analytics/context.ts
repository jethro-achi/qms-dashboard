// lib/analytics/context.ts
// Shared per-request context for every analytics report page: the signed-in
// user, their RLS principal, and the current global filters (from the cookie).
import { cookies } from "next/headers";
import { requireUser, toPrincipal, type SessionUser } from "../session";
import type { Principal } from "../rbac";
import { getShowTodayDefault } from "../settings";
import { FILTER_COOKIE, parseFilters, hasActiveFilters, withTodayResolved, type AnalyticsFilters } from "./filters";

export interface ReportContext {
  user: SessionUser;
  principal: Principal;
  filters: AnalyticsFilters;
  activeCount: number;
}

export async function reportContext(): Promise<ReportContext> {
  const user = await requireUser();
  const principal = toPrincipal(user);
  const cookieStore = await cookies();
  const raw = cookieStore.get(FILTER_COOKIE)?.value;
  const parsed = parseFilters(raw ? decodeURIComponent(raw) : raw);
  // Report pages honour the app-wide "today" default too, so they open scoped
  // to today until the user turns the dashboard toggle off (persisted in the
  // shared cookie) or picks an explicit date range.
  const showTodayDefault = await getShowTodayDefault();
  const filters = withTodayResolved(parsed, showTodayDefault);

  let activeCount = 0;
  if (hasActiveFilters(parsed)) {
    if (parsed.dateFrom || parsed.dateTo) activeCount++;
    if (parsed.branchIds?.length) activeCount++;
    if (parsed.queueIds?.length) activeCount++;
    if (parsed.statuses?.length) activeCount++;
    if (parsed.serviceNames?.length) activeCount++;
    if (parsed.staffIds?.length) activeCount++;
  }
  return { user, principal, filters, activeCount };
}
