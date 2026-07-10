import { DashboardShell } from "@/components/dashboard-shell"
import { AnalyticsFilterBar } from "@/components/analytics/analytics-filter-bar"
import { ReportTable, type Column } from "@/components/analytics/report-table"
import { ReportError } from "@/components/analytics/report-bits"
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
  days: number
}

const columns: Column<Row>[] = [
  { key: "staff", header: "Staff" },
  { key: "branch", header: "Branch" },
  { key: "served", header: "#Customers", align: "right" },
  { key: "pctSla", header: "% Within SLA", align: "right" },
  { key: "avgServiceMin", header: "Avg Service Time", align: "right" },
  { key: "avgWaitMin", header: "Avg Waiting Time", align: "right" },
  { key: "days", header: "#Days", align: "right" },
]

export default async function LeaderboardPage() {
  const { user, principal, filters, activeCount } = await reportContext()

  let body: React.ReactNode
  try {
    const staff = await getStaffProductivity(filters, principal)
    // Rank: outstanding first (service <= 5 min, SLA > 80%, wait <= 10 min),
    // then by volume served.
    const scored = staff
      .map((s) => ({
        ...s,
        outstanding: s.avgServiceMin <= 5 && s.pctSla > 80 && s.avgWaitMin <= 10,
      }))
      .sort((a, b) => Number(b.outstanding) - Number(a.outstanding) || b.served - a.served)
    const rows: Row[] = scored.map((s) => ({
      staff: s.staff,
      branch: s.branch,
      served: s.served,
      pctSla: `${s.pctSla}%`,
      avgServiceMin: s.avgServiceMin.toFixed(1),
      avgWaitMin: s.avgWaitMin.toFixed(1),
      days: s.days,
    }))
    body = (
      <>
        <p className="text-sm text-muted-foreground">
          The CX Leaderboard showcases staff who have been outstanding over a given period based on
          <strong className="text-foreground"> Service Time ≤ 5 minutes</strong>,
          <strong className="text-foreground"> % served within SLA &gt; 80%</strong>, and
          <strong className="text-foreground"> waiting time for customers served ≤ 10 minutes</strong>.
        </p>
        <ReportTable columns={columns} rows={rows} searchKey="staff" searchLabel="Search by staff name" exportTitle="Leaderboard" />
      </>
    )
  } catch (error) {
    body = <ReportError error={error} />
  }

  return (
    <DashboardShell user={user} title="Leaderboard">
      <div className="flex flex-col gap-4 px-4 lg:px-6">
        <AnalyticsFilterBar filters={filters} activeCount={activeCount} />
        {body}
      </div>
    </DashboardShell>
  )
}
