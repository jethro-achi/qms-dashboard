import { DashboardShell } from "@/components/dashboard-shell"
import { AnalyticsFilterBar } from "@/components/analytics/analytics-filter-bar"
import { ReportTable, type Column } from "@/components/analytics/report-table"
import { FilterableBarCard } from "@/components/analytics/filterable-bar-card"
import { ReportError } from "@/components/analytics/report-bits"
import { reportContext } from "@/lib/analytics/context"
import { getExceptions } from "@/lib/analytics/reports"
import { fmtDateTime } from "@/lib/analytics/format"

export const dynamic = "force-dynamic"

interface Row extends Record<string, unknown> {
  agent: string
  branch: string
  ticketNo: string
  timeIn: string
  serviceStart: string
  serviceEnd: string
  serviceMin: number
  waitMin: number
}

const columns: Column<Row>[] = [
  { key: "agent", header: "Agent" },
  { key: "branch", header: "Branch" },
  { key: "ticketNo", header: "Ticket" },
  { key: "timeIn", header: "Time In" },
  { key: "serviceStart", header: "Service Start" },
  { key: "serviceEnd", header: "Service End" },
  { key: "serviceMin", header: "Service Time (min)", align: "right" },
  { key: "waitMin", header: "Wait Time (min)", align: "right" },
]

export default async function ExceptionsPage() {
  const { user, principal, filters, activeCount } = await reportContext()

  let body: React.ReactNode
  try {
    const { rows: raw, byStaff, thresholdMin } = await getExceptions(filters, principal)
    const rows: Row[] = raw.map((r) => ({
      agent: r.agent,
      branch: r.branch,
      ticketNo: r.ticketNo,
      timeIn: fmtDateTime(r.timeIn),
      serviceStart: fmtDateTime(r.serviceStart),
      serviceEnd: fmtDateTime(r.serviceEnd),
      serviceMin: r.serviceMin,
      waitMin: r.waitMin,
    }))
    body = (
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col justify-center">
          <p className="text-sm text-muted-foreground">
            The <strong className="text-foreground">Exceptions / Anomalies</strong> report identifies
            erroneous / abnormal records based on service time. All records here have a customer
            service time <strong className="text-foreground">&gt; {thresholdMin} minutes</strong>.
          </p>
        </div>
        <FilterableBarCard
          title="Average Anomaly Service Time by Staff (min)"
          data={byStaff}
          orientation="horizontal"
          valueSuffix=" min"
          labelWidth={100}
          exportColumns={[{ key: "label", header: "Staff" }, { key: "value", header: "Avg Service (min)" }]}
        />
        <div className="lg:col-span-2">
          <ReportTable
            columns={columns}
            rows={rows}
            searchKey="agent"
            searchLabel="Search by staff name"
            emptyText="No anomalies (no ticket exceeded 60 minutes of service time)."
            exportTitle="Exceptions"
          />
        </div>
      </div>
    )
  } catch (error) {
    body = <ReportError error={error} />
  }

  return (
    <DashboardShell user={user} title="Exceptions">
      <div className="flex flex-col gap-4 px-4 lg:px-6">
        <AnalyticsFilterBar filters={filters} activeCount={activeCount} />
        {body}
      </div>
    </DashboardShell>
  )
}
