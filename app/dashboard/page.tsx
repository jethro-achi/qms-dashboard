import { cookies } from "next/headers"

import { DashboardShell } from "@/components/dashboard-shell"
import { KpiCards } from "@/components/analytics/kpi-cards"
import { TrafficAreaChart } from "@/components/analytics/traffic-area-chart"
import { TopDriversChart } from "@/components/analytics/top-drivers-chart"
import { HourlyTrafficChart } from "@/components/analytics/hourly-traffic-chart"
import { FilterBar } from "@/components/analytics/filter-bar"
import { TodayToggle } from "@/components/analytics/today-toggle"
import { Card, CardContent } from "@/components/ui/card"
import { requireUser, toPrincipal } from "@/lib/session"
import { FILTER_COOKIE, parseFilters, hasActiveFilters, withTodayResolved } from "@/lib/analytics/filters"
import { getKpis, getTopDrivers, getHourlyTraffic, getTrafficTrend, getFilterOptions } from "@/lib/analytics/queries"
import { getShowTodayDefault } from "@/lib/settings"
import { getHomeKpis, getTrafficSeries } from "@/lib/analytics/home"

export const dynamic = "force-dynamic"

function fmt(iso: string | null): string | null {
  if (!iso) return null
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
}

export default async function DashboardPage() {
  const user = await requireUser()
  const principal = toPrincipal(user)

  const cookieStore = await cookies()
  const raw = cookieStore.get(FILTER_COOKIE)?.value
  const rawFilters = parseFilters(raw ? decodeURIComponent(raw) : raw)
  const showTodayDefault = await getShowTodayDefault()
  const filters = withTodayResolved(rawFilters, showTodayDefault)

  let content: React.ReactNode
  try {
    const [homeKpis, series, meta, drivers, hourly, trend, options] = await Promise.all([
      getHomeKpis(filters, principal),
      getTrafficSeries(filters, principal),
      getKpis(filters, principal),
      getTopDrivers(filters, principal, 10),
      getHourlyTraffic(filters, principal),
      getTrafficTrend(filters, principal),
      getFilterOptions(),
    ])

    const from = fmt(meta.minCreated)
    const to = fmt(meta.maxCreated)
    const range = from && to ? (from === to ? from : `${from} – ${to}`) : "no data in range"

    content = (
      <>
        <div className="flex flex-wrap items-center gap-2">
          <FilterBar options={options} current={rawFilters} activeCount={hasActiveFilters(rawFilters) ? countActive(rawFilters) : 0} />
          {/* Per-user "today" toggle, always visible. The app-wide "Default to
              today's data" setting only seeds the initial state for a user who
              hasn't chosen; each user's choice persists in their own filter
              cookie, so it never locks anyone else. */}
          <TodayToggle active={Boolean(filters.today)} current={rawFilters} />
        </div>
        <KpiCards kpis={homeKpis} />
        <TrafficAreaChart data={series} />
        <div className="grid gap-4 lg:grid-cols-2">
          <TopDriversChart data={drivers} trend={trend} subtitle={range} />
          <HourlyTrafficChart data={hourly} trend={trend} subtitle={range} />
        </div>
      </>
    )
  } catch (err) {
    content = (
      <Card>
        <CardContent className="py-8 text-sm">
          <p className="font-medium text-rose-600 dark:text-rose-400">Could not load analytics.</p>
          <p className="mt-1 text-muted-foreground">
            The QMS database could not be reached. Check the <code>QMS_DB_*</code> settings and that the
            database is running.
          </p>
          <p className="mt-2 font-mono text-xs text-muted-foreground">{(err as Error).message}</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <DashboardShell user={user} title="Queue Management Dashboard">
      <div className="flex flex-col gap-4 px-4 lg:px-6">{content}</div>
    </DashboardShell>
  )
}

function countActive(f: ReturnType<typeof parseFilters>): number {
  let n = 0
  if (f.dateFrom || f.dateTo) n += 1
  if (f.branchIds?.length) n += 1
  if (f.queueIds?.length) n += 1
  if (f.statuses?.length) n += 1
  if (f.serviceNames?.length) n += 1
  if (f.staffIds?.length) n += 1
  return n
}
