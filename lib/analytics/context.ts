// lib/analytics/context.ts
// Shared per-request context for every analytics report page: the signed-in
// user, their RLS principal, and the current global filters (from the cookie).
import { cookies } from "next/headers";
import { requireUser, toPrincipal, type SessionUser } from "../session";
import type { Principal } from "../rbac";
import { FILTER_COOKIE, parseFilters, hasActiveFilters, type AnalyticsFilters } from "./filters";

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
  const filters = parseFilters(raw ? decodeURIComponent(raw) : raw);

  let activeCount = 0;
  if (hasActiveFilters(filters)) {
    if (filters.dateFrom || filters.dateTo) activeCount++;
    if (filters.branchIds?.length) activeCount++;
    if (filters.queueIds?.length) activeCount++;
    if (filters.statuses?.length) activeCount++;
  }
  return { user, principal, filters, activeCount };
}
