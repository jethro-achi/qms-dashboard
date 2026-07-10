import { DashboardShell } from "@/components/dashboard-shell"
import { AnalyticsFilterBar } from "@/components/analytics/analytics-filter-bar"
import { ReportTable, type Column } from "@/components/analytics/report-table"
import { ReportError } from "@/components/analytics/report-bits"
import { reportContext } from "@/lib/analytics/context"
import { getDataRefresh } from "@/lib/analytics/reports"
import { fmtDate } from "@/lib/analytics/format"

export const dynamic = "force-dynamic"

interface Row extends Record<string, unknown> {
  branch: string
  startDate: string
  lastDate: string
}

const columns: Column<Row>[] = [
  { key: "branch", header: "Branch" },
  { key: "startDate", header: "Data Start Date" },
  { key: "lastDate", header: "Last Updated Date" },
]

export default async function DataRefreshPage() {
  const { user, principal, filters, activeCount } = await reportContext()

  let body: React.ReactNode
  try {
    const data = await getDataRefresh(filters, principal)
    const rows: Row[] = data.map((d) => ({
      branch: d.branch,
      startDate: fmtDate(d.startDate),
      lastDate: fmtDate(d.lastDate),
    }))
    body = <ReportTable columns={columns} rows={rows} emptyText="No data available." exportTitle="Data Refresh" />
  } catch (error) {
    body = <ReportError error={error} />
  }

  return (
    <DashboardShell user={user} title="Data Refresh">
      <div className="flex flex-col gap-4 px-4 lg:px-6">
        <AnalyticsFilterBar filters={filters} activeCount={activeCount} />
        {body}
      </div>
    </DashboardShell>
  )
}
