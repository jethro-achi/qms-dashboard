// components/analytics/analytics-filter-bar.tsx
// Server wrapper that self-fetches the filter option lists and renders the
// client FilterBar. Resilient: if the QMS DB is unreachable the bar still
// renders (with empty option lists) so the user can still clear filters.
import { FilterBar } from "./filter-bar"
import { getFilterOptions, type FilterOptions } from "@/lib/analytics/queries"
import type { AnalyticsFilters } from "@/lib/analytics/filters"

export async function AnalyticsFilterBar({
  filters,
  activeCount,
}: {
  filters: AnalyticsFilters
  activeCount: number
}) {
  let options: FilterOptions = { branches: [], queues: [], statuses: [] }
  try {
    options = await getFilterOptions()
  } catch {
    /* keep empty options */
  }
  return <FilterBar options={options} current={filters} activeCount={activeCount} />
}
