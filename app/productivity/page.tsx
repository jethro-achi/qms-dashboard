import Link from "next/link"

import { DashboardShell } from "@/components/dashboard-shell"
import { AnalyticsFilterBar } from "@/components/analytics/analytics-filter-bar"
import { ReportTable, type Column } from "@/components/analytics/report-table"
import { FilterableBarCard } from "@/components/analytics/filterable-bar-card"
import { SlaStatusChart } from "@/components/analytics/sla-status-chart"
import { ReportError } from "@/components/analytics/report-bits"
import { Button } from "@/components/ui/button"
import { reportContext } from "@/lib/analytics/context"
import { getStaffProductivity } from "@/lib/analytics/reports"

export const dynamic = "force-dynamic"

interface Row extends Record<string, unknown> {
  staff: string
  branch: string
  served: number
  pctSla: string
  avgServiceMin: string
  avgWaitMin: string
}

const columns: Column<Row>[] = [
  { key: "staff", header: "Staff" },
  { key: "branch", header: "Branch" },
  { key: "served", header: "Customers Served", align: "right" },
  { key: "pctSla", header: "% Served within SLA", align: "right" },
  { key: "avgServiceMin", header: "Avg Service Time", align: "right" },
  { key: "avgWaitMin", header: "Avg Waiting Time", align: "right" },
]

export default async function ProductivityPage() {
  const { user, principal, filters, activeCount } = await reportContext()

  let body: React.ReactNode
  try {
    const staff = await getStaffProductivity(filters, principal)
    const rows: Row[] = staff.map((s) => ({
      staff: s.staff,
      branch: s.branch,
      served: s.served,
      pctSla: `${s.pctSla}%`,
      avgServiceMin: s.avgServiceMin.toFixed(1),
      avgWaitMin: s.avgWaitMin.toFixed(1),
    }))
    body = (
      <>
        <ReportTable
          columns={columns}
          rows={rows}
          searchKey="staff"
          searchLabel="Search by staff name"
          exportTitle="Staff Productivity"
        />
        <div className="grid gap-4 lg:grid-cols-2">
          <SlaStatusChart data={staff.map((s) => ({ staff: s.staff, within: s.slaWithin, outside: s.slaOutside }))} />
          <FilterableBarCard
            title="Average Customer Service Time per Staff"
            data={staff.map((s) => ({ label: s.staff, value: s.avgServiceMin }))}
            orientation="horizontal"
            valueSuffix=" min"
            labelWidth={90}
            exportColumns={[{ key: "label", header: "Staff" }, { key: "value", header: "Avg Service (min)" }]}
          />
        </div>
      </>
    )
  } catch (error) {
    body = <ReportError error={error} />
  }

  return (
    <DashboardShell user={user} title="Staff Productivity">
      <div className="flex flex-col gap-4 px-4 lg:px-6">
        <div className="flex items-center justify-between gap-2">
          <AnalyticsFilterBar filters={filters} activeCount={activeCount} />
          <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/agent-activity" />}>
            View Agent Logs
          </Button>
        </div>
        {body}
      </div>
    </DashboardShell>
  )
}
