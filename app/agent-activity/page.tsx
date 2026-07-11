import { DashboardShell } from "@/components/dashboard-shell"
import { ReportTable, type Column } from "@/components/analytics/report-table"
import { StatTile, ReportError, ChartCard } from "@/components/analytics/report-bits"
import { SimpleBarChart } from "@/components/analytics/simple-bar-chart"
import { requireUser } from "@/lib/session"
import { getAgentActivity } from "@/lib/analytics/reports"
import { fmtDateTime } from "@/lib/analytics/format"

export const dynamic = "force-dynamic"

interface LogRow extends Record<string, unknown> {
  date: string
  agent: string
  action: string
  details: string
}

interface AvailRow extends Record<string, unknown> {
  agent: string
  availableMin: number
  unavailableMin: number
  sessions: number
  lastSeen: string
}

const logColumns: Column<LogRow>[] = [
  { key: "date", header: "Date / Time" },
  { key: "agent", header: "Agent" },
  { key: "action", header: "Action" },
  { key: "details", header: "Details" },
]

const availColumns: Column<AvailRow>[] = [
  { key: "agent", header: "Agent" },
  { key: "availableMin", header: "Available (min)" },
  { key: "unavailableMin", header: "Unavailable (min)" },
  { key: "sessions", header: "Sessions" },
  { key: "lastSeen", header: "Last seen" },
]

export default async function AgentActivityPage() {
  const user = await requireUser()

  let body: React.ReactNode
  try {
    const a = await getAgentActivity()

    const logRows: LogRow[] = a.logs.map((l) => ({
      date: fmtDateTime(l.date),
      agent: l.agent,
      action: l.action,
      details: l.details,
    }))

    const availRows: AvailRow[] = a.availability.map((x) => ({
      agent: x.agent,
      availableMin: x.availableMin,
      unavailableMin: x.unavailableMin,
      sessions: x.sessions,
      lastSeen: x.lastSeen ? fmtDateTime(x.lastSeen) : "—",
    }))

    // Most active = most logged-in minutes; most idle = most time between sessions.
    const mostActive = a.availability
      .filter((x) => x.availableMin > 0)
      .slice(0, 8)
      .map((x) => ({ label: x.agent, value: x.availableMin }))
    const mostIdle = [...a.availability]
      .sort((p, q) => q.unavailableMin - p.unavailableMin)
      .filter((x) => x.unavailableMin > 0)
      .slice(0, 8)
      .map((x) => ({ label: x.agent, value: x.unavailableMin }))

    body = (
      <>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile label="Total Agents" value={a.totalAgents} sub="With a service counter" />
          <StatTile label="Active Now" value={a.activeStaff} sub="Currently available" />
          <StatTile label="Inactive Now" value={a.inactiveStaff} sub="Currently unavailable" />
          <StatTile label="Logins" value={a.logins} sub="Successful sign-ins" />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard
            title="Most active agents (available minutes)"
            exportColumns={[{ key: "label", header: "Agent" }, { key: "value", header: "Available (min)" }]}
            exportRows={mostActive}
          >
            <SimpleBarChart data={mostActive} orientation="horizontal" valueSuffix=" min" labelWidth={140} />
          </ChartCard>
          <ChartCard
            title="Most idle agents (unavailable minutes)"
            exportColumns={[{ key: "label", header: "Agent" }, { key: "value", header: "Unavailable (min)" }]}
            exportRows={mostIdle}
          >
            <SimpleBarChart data={mostIdle} orientation="horizontal" valueSuffix=" min" labelWidth={140} />
          </ChartCard>
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            Available = time logged in (paired Login→Logout); Unavailable = idle time between sessions,
            over the last 30 days of activity.
          </p>
          <ReportTable
            columns={availColumns}
            rows={availRows}
            searchKey="agent"
            searchLabel="Search by agent name"
            exportTitle="Agent Availability"
          />
        </div>

        <ReportTable
          columns={logColumns}
          rows={logRows}
          searchKey="agent"
          searchLabel="Search by agent name"
          exportTitle="Agent Activity"
        />
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
