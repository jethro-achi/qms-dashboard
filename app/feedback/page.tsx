import { DashboardShell } from "@/components/dashboard-shell"
import { AnalyticsFilterBar } from "@/components/analytics/analytics-filter-bar"
import { ReportTable, type Column } from "@/components/analytics/report-table"
import { InteractiveBarCard } from "@/components/analytics/interactive-bar-card"
import { ReportError, StatTile } from "@/components/analytics/report-bits"
import { reportContext } from "@/lib/analytics/context"
import { getFeedback } from "@/lib/analytics/reports"
import { fmtDateTime } from "@/lib/analytics/format"

export const dynamic = "force-dynamic"

interface Row extends Record<string, unknown> {
  branch: string
  comment: string
  ticketNo: string
  date: string
}

const columns: Column<Row>[] = [
  { key: "branch", header: "Branch" },
  { key: "comment", header: "Rating Comment" },
  { key: "ticketNo", header: "Ticket No" },
  { key: "date", header: "Date" },
]

export default async function FeedbackPage() {
  const { user, principal, filters, activeCount } = await reportContext()

  let body: React.ReactNode
  try {
    const f = await getFeedback(filters, principal)
    const rows: Row[] = f.comments.map((c) => ({
      branch: c.branch,
      comment: c.comment,
      ticketNo: c.ticketNo,
      date: fmtDateTime(c.date),
    }))
    body = (
      <>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <StatTile label="Net Promoter Score" value={f.nps} sub="NPS (-100 to +100)" />
          <StatTile label="Total Ratings" value={f.totalRated} sub="Ratings" />
          <StatTile label="Happy Customers" value={f.promoters} sub="Promoters" />
          <StatTile label="Neutral Customers" value={f.passives} sub="Passives" />
          <StatTile label="Unhappy Customers" value={f.detractors} sub="Detractors" />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <InteractiveBarCard
            title="Net Promoter Score by Branch"
            data={f.byBranch.map((b) => ({ label: b.label, value: b.nps }))}
            series={[{ key: "value", label: "Avg NPS", color: "var(--chart-1)" }]}
            aggregate="avg"
            exportColumns={[{ key: "label", header: "Branch" }, { key: "value", header: "NPS" }]}
          />
          <InteractiveBarCard
            title="Rating Distribution"
            data={f.ratingDistribution}
            series={[{ key: "value", label: "Ratings", color: "var(--chart-1)" }]}
            aggregate="sum"
            exportColumns={[{ key: "label", header: "Rating" }, { key: "value", header: "Count" }]}
          />
        </div>
        <div>
          <p className="mb-2 text-base font-medium">Customer Feedback Overview</p>
          <ReportTable columns={columns} rows={rows} emptyText="No rating comments for these filters." exportTitle="Customer Feedback" />
        </div>
      </>
    )
  } catch (error) {
    body = <ReportError error={error} />
  }

  return (
    <DashboardShell user={user} title="Customer Feedback Report">
      <div className="flex flex-col gap-4 px-4 lg:px-6">
        <AnalyticsFilterBar filters={filters} activeCount={activeCount} />
        {body}
      </div>
    </DashboardShell>
  )
}
