import { DashboardShell } from "@/components/dashboard-shell"
import { ReportTable, type Column } from "@/components/analytics/report-table"
import { StatTile, ReportError } from "@/components/analytics/report-bits"
import { requireUser } from "@/lib/session"
import { getAgentActivity } from "@/lib/analytics/reports"
import { fmtDateTime } from "@/lib/analytics/format"

export const dynamic = "force-dynamic"

interface Row extends Record<string, unknown> {
  date: string
  agent: string
  action: string
  details: string
}

const columns: Column<Row>[] = [
  { key: "date", header: "Date / Time" },
  { key: "agent", header: "Agent" },
  { key: "action", header: "Action" },
  { key: "details", header: "Details" },
]

export default async function AgentActivityPage() {
  const user = await requireUser()

  let body: React.ReactNode
  try {
    const a = await getAgentActivity()
    const rows: Row[] = a.logs.map((l) => ({
      date: fmtDateTime(l.date),
      agent: l.agent,
      action: l.action,
      details: l.details,
    }))
    body = (
      <>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile label="Logins" value={a.logins} sub="Successful sign-ins" />
          <StatTile label="Active" value={a.activeStaff} sub="Staff available" />
          <StatTile label="Inactive" value={a.inactiveStaff} sub="Staff unavailable" />
          <StatTile label="Log Entries" value={a.logs.length} sub="Recent activity" />
        </div>
        <ReportTable columns={columns} rows={rows} searchKey="agent" searchLabel="Search by agent name" exportTitle="Agent Activity" />
      </>
    )
  } catch (error) {
    body = <ReportError error={error} />
  }

  return (
    <DashboardShell user={user} title="Agent Activity Report">
      <div className="flex flex-col gap-4 px-4 lg:px-6">{body}</div>
    </DashboardShell>
  )
}
