import { DashboardShell } from "@/components/dashboard-shell"
import { AnalyticsFilterBar } from "@/components/analytics/analytics-filter-bar"
import { FilterableBarCard } from "@/components/analytics/filterable-bar-card"
import { InteractiveBarCard } from "@/components/analytics/interactive-bar-card"
import { ReportError } from "@/components/analytics/report-bits"
import { reportContext } from "@/lib/analytics/context"
import { getBranchOverview } from "@/lib/analytics/reports"

export const dynamic = "force-dynamic"

const TOTAL_SERVED_SERIES = [
  { key: "total", label: "Total", color: "var(--chart-1)" },
  { key: "served", label: "Served", color: "var(--chart-2)" },
]
const TOTAL_SERVED_COLS = [
  { key: "label", header: "Category" },
  { key: "total", header: "Total" },
  { key: "served", header: "Served" },
]

export default async function BranchOverviewPage() {
  const { user, principal, filters, activeCount } = await reportContext()

  let body: React.ReactNode
  try {
    const o = await getBranchOverview(filters, principal)
    body = (
      <div className="grid gap-4 lg:grid-cols-2">
        <InteractiveBarCard
          title="Customer Traffic by Branch"
          data={o.trafficByBranch}
          series={TOTAL_SERVED_SERIES}
          aggregate="sum"
          exportColumns={[{ key: "label", header: "Branch" }, { key: "total", header: "Total" }, { key: "served", header: "Served" }]}
        />
        <InteractiveBarCard
          title="Busy Days - Traffic by Day of Week"
          data={o.busyDays}
          series={TOTAL_SERVED_SERIES}
          aggregate="sum"
          exportColumns={TOTAL_SERVED_COLS.map((c) => (c.key === "label" ? { key: "label", header: "Day" } : c))}
        />
        <InteractiveBarCard
          title="Average Service Time per Branch"
          data={o.service}
          series={[{ key: "value", label: "Avg service time", color: "var(--chart-1)" }]}
          aggregate="avg"
          valueSuffix=" min"
          exportColumns={[{ key: "label", header: "Branch" }, { key: "value", header: "Avg Service (min)" }]}
        />
        <FilterableBarCard
          title="Average Waiting Time (Minutes) by Branch"
          data={o.wait}
          orientation="horizontal"
          labelWidth={110}
          exportColumns={[{ key: "label", header: "Branch" }, { key: "value", header: "Avg Wait (min)" }]}
        />
        <div className="lg:col-span-2">
          <InteractiveBarCard
            title="Wait Time Distribution"
            data={o.waitDistribution}
            series={[{ key: "value", label: "Tickets", color: "var(--chart-1)" }]}
            aggregate="sum"
            exportColumns={[{ key: "label", header: "Wait band" }, { key: "value", header: "Tickets" }]}
          />
        </div>
      </div>
    )
  } catch (error) {
    body = <ReportError error={error} />
  }

  return (
    <DashboardShell user={user} title="Branch Overview">
      <div className="flex flex-col gap-4 px-4 lg:px-6">
        <AnalyticsFilterBar filters={filters} activeCount={activeCount} />
        {body}
      </div>
    </DashboardShell>
  )
}
