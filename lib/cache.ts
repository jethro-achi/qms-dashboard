// lib/cache.ts
// -----------------------------------------------------------------------------
// Tiny in-process TTL memo for the read-only QMS analytics queries. Repeat
// dashboard loads and rapid filter toggling collapse from N identical
// full-table scans into a single DB round-trip per TTL window, and concurrent
// identical requests are coalesced onto one in-flight query (the Promise itself
// is cached, so N simultaneous loads share one scan).
//
// Scope & safety:
//   - Holds only AGGREGATE analytics (counts/sums/averages) — never row-level
//     PII. The detail/feedback/exception queries are intentionally NOT cached.
//   - The branch RLS scope is part of every key (see analyticsKey), so a
//     branch-restricted user can never read another scope's cached result.
//   - Not shared across instances (each container caches its own) — correct for
//     the on-prem single-container deployment; analytics tolerate a few seconds
//     of staleness. Set QMS_CACHE_TTL=0 to disable entirely.
// -----------------------------------------------------------------------------
import { seesAllBranches, type Principal } from "./rbac";
import type { AnalyticsFilters } from "./analytics/filters";

const TTL_MS = Math.max(0, Number(process.env.QMS_CACHE_TTL ?? 30)) * 1000;

interface Entry {
  expires: number;
  value: Promise<unknown>;
}
const store = new Map<string, Entry>();

export async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  if (TTL_MS <= 0) return fn();
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expires > now) return hit.value as Promise<T>;

  const value = fn();
  store.set(key, { expires: now + TTL_MS, value });
  // Never cache a failed DB call — evict on rejection so the next load retries.
  value.catch(() => {
    if (store.get(key)?.value === value) store.delete(key);
  });
  // Bound memory: opportunistically drop expired entries when the map grows.
  if (store.size > 500) for (const [k, e] of store) if (e.expires <= now) store.delete(k);
  return value;
}

/**
 * Build an RLS-safe cache key. The branch scope is baked in, so a
 * branch-restricted principal can never collide with a wider scope. `extra`
 * carries any scalar that changes the result (SLA seconds, TZ offset, limit).
 */
export function analyticsKey(
  name: string,
  filters: AnalyticsFilters,
  principal: Principal,
  extra: readonly (string | number)[] = [],
): string {
  const scope = seesAllBranches(principal.role)
    ? "ALL"
    : [...principal.allowedBranchIds].map(String).sort();
  return JSON.stringify([name, scope, filters, extra]);
}
