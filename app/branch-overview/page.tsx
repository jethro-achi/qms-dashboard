import { DashboardShell } from "@/components/dashboard-shell"
import { AnalyticsFilterBar } from "@/components/analytics/analytics-filter-bar"
import { InteractiveBarCard } from "@/components/analytics/interactive-bar-card"
import { DrilldownBarCard } from "@/components/analytics/drilldown-bar-card"
import { ReportError } from "@/components/analytics/report-bits"
import { reportContext } from "@/lib/analytics/context"
import { getBranchOverview } from "@/lib/analytics/reports"
import { getBreakdown } from "@/lib/analytics/breakdown"

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
    const [o, waitRows, serviceRows] = await Promise.all([
      getBranchOverview(filters, principal),
      getBreakdown({ metric: "avgWait", dimension: "branch", filters, principal }),
      getBreakdown({ metric: "avgService", dimension: "branch", filters, principal }),
    ])
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
        {/* Drillable: start by branch, then break down by service / agent / etc. */}
        <DrilldownBarCard
          title="Average Service Time per Branch"
          metric="avgService"
          baseDimension="branch"
          initialRows={serviceRows}
          valueSuffix=" min"
        />
        <DrilldownBarCard
          title="Average Waiting Time (Minutes) by Branch"
          metric="avgWait"
          baseDimension="branch"
          initialRows={waitRows}
          orientation="horizontal"
          labelWidth={110}
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
