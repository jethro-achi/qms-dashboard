import { DashboardShell } from "@/components/dashboard-shell"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { requireUser } from "@/lib/session"
import { canChangeAppSettings, canManageUsers } from "@/lib/rbac"

export const dynamic = "force-dynamic"

const METRICS: { term: string; desc: string }[] = [
  { term: "Customer Traffic", desc: "The number of customers visiting each branch during a specific period." },
  { term: "Average Waiting Time", desc: "The average amount of time customers spend waiting for service at each branch." },
  { term: "Average Service Time", desc: "The average time taken to serve each customer. A shorter average service time implies efficient, quick service delivery — positively impacting customer experience and loyalty." },
  { term: "% of Customers Served Within SLA", desc: "The percentage of served customers who met the Service Level Agreement (SLA). A ticket meets SLA only when both its wait time and its service time are within target (by default, waiting within 10 minutes and service within 5 minutes). These targets are configurable in Settings. A higher percentage indicates better staff performance." },
  { term: "% of Customers Served Outside SLA", desc: "The percentage of served customers who breached SLA — their wait time OR their service time exceeded target. A lower percentage is desirable." },
  { term: "Net Promoter Score (NPS)", desc: "Assesses how likely customers are to recommend the service. Calculated by subtracting detractors from promoters, giving a score between -100 and +100. Positive NPS implies strong loyalty; negative NPS suggests areas for improvement." },
  { term: "Promoters", desc: "Highly satisfied customers (rating 5)." },
  { term: "Passives", desc: "Customers who are moderately satisfied with services at the branch (rating 4)." },
  { term: "Detractors", desc: "Unhappy customers indicating negative sentiment and potential issues to address (rating 3 or below)." },
]

const FAQ: { q: string; a: string }[] = [
  { q: "How do filters work?", a: "Use “Show Filters” at the top of any report to filter by date range, branch, service queue, or status. Filters persist across every page until you clear them. Each chart also has its own filter (funnel icon) to slice just that visual." },
  { q: "How do I export a chart or table?", a: "Click the download icon on any visual. You'll be able to choose where to save the Excel file and name it; the sheet is titled after the visualization." },
  { q: "Who can change the theme or manage users?", a: "Only a Super Administrator can change the app-wide theme/colors, upload the client logo, and add or remove users." },
  { q: "Why is a branch manager seeing only some branches?", a: "Branch managers and tellers are scoped to their assigned branch(es); admins and super admins see all branches." },
]

// A step-by-step summary of how to perform every function in the dashboard.
// `roles` gates admin-only groups so users only see what applies to them.
type HowToGroup = {
  area: string
  roles?: "manageUsers" | "settings"
  items: { task: string; steps: string }[]
}

const HOWTO: HowToGroup[] = [
  {
    area: "Getting around",
    items: [
      { task: "Open a report", steps: "Use the left sidebar to move between Home, Branch Overview, Productivity, Leaderboard, Exceptions, Feedback and more. The sidebar can be collapsed with the toggle at the top-left of the header." },
      { task: "Switch light / dark mode", steps: "Click the Sun/Moon button in the top-right of the header. Your choice is remembered on this device; it doesn't change what other users see." },
      { task: "Find your account & sign out", steps: "Open your name at the bottom of the sidebar to sign out. For security, the app returns you to the login screen automatically after a period of inactivity." },
    ],
  },
  {
    area: "Filtering & date ranges",
    items: [
      { task: "Apply global filters", steps: "Click “Show Filters” at the top of a page and choose a date range, branch, queue, or status. These apply to every chart and KPI on the page and stay set as you move between pages." },
      { task: "Clear filters", steps: "Reopen “Show Filters” and use Reset/Clear to return to the default view." },
      { task: "Filter a single chart", steps: "Click the funnel icon on an individual chart to slice just that visual without touching the rest of the page." },
    ],
  },
  {
    area: "Reading the dashboards",
    items: [
      { task: "Read a KPI card", steps: "Each card shows the current value plus two trends: “vs last month” (top-right badge) and “vs yesterday” (footer). Green means the metric moved in the good direction; a dash (—) means there isn't enough history yet to compare fairly." },
      { task: "Use the interactive bar charts", steps: "The stat tiles across the top of a bar chart double as toggles — click one to show or hide that series' bars. The header total updates to match what's shown." },
      { task: "See when data was last updated", steps: "The header shows a live status light (green = connected to the database, red = unreachable) and an “Updated …” timestamp of the most recent queue activity." },
      { task: "Refresh the latest data", steps: "Click “Refresh now” in the header. A progress overlay walks through connecting, fetching and applying, then reloads the page with fresh figures and a new timestamp." },
    ],
  },
  {
    area: "Exporting",
    items: [
      { task: "Export a chart or table", steps: "Click the download icon on any visual and choose where to save. The file is an Excel workbook named after the visualization." },
    ],
  },
  {
    area: "Messages",
    items: [
      { task: "Send a message", steps: "Open Messages from the sidebar, type your note and send. Attach a file with the paperclip/attachment control; supported files are checked and size-limited." },
      { task: "Edit or delete a message", steps: "Hover a message you sent to edit it or delete it. To remove several at once, select multiple messages and delete them together." },
      { task: "Know when something's new", steps: "A badge on the Messages nav item shows unread count, and a preview of the latest message floats in the bottom-right with the sender's name, role and a snippet (or “Attachment”)." },
    ],
  },
  {
    area: "Reports",
    items: [
      { task: "Generate & download reports", steps: "Open Reports from the sidebar to generate a report and download stored copies (Excel/PDF). Reports are scoped to your branch access. (The Super Admin manages settings rather than running branch reports.)" },
    ],
  },
  {
    area: "User management",
    roles: "manageUsers",
    items: [
      { task: "Add a user", steps: "On User management click “Add user”, enter their work email, name, a password (12+ characters), a role, and — for branch-scoped roles — the branches they may see. Save to create the account." },
      { task: "Edit a user", steps: "Click the pencil icon on a row to change their name, role, branch access, or active status." },
      { task: "Reset a password", steps: "Open a user, type a new password in “Reset password”, then Save. You'll be asked to confirm because their old password stops working immediately." },
      { task: "Remove a user", steps: "Click the trash icon on a row. A confirmation dialog names the account; confirming permanently deletes it and revokes access. You can't delete your own account." },
    ],
  },
  {
    area: "Audit log",
    roles: "manageUsers",
    items: [
      { task: "Review who did what", steps: "Open Audit log to see a tamper-evident trail of administrative and sign-in activity, with actor, time, IP and action. An integrity badge confirms the record hasn't been altered." },
      { task: "Export the audit trail", steps: "Use the export/download control on the Audit log to save the entries as a CSV for your records." },
    ],
  },
  {
    area: "Appearance & branding",
    roles: "settings",
    items: [
      { task: "Set the default theme", steps: "In Settings → Appearance, pick the default light/dark mode for everyone. Individual users can still flip their own view from the header." },
      { task: "Choose brand colours", steps: "Set Primary, Secondary and Accent, or leave any on “default” to use the built-in palette. Click Save appearance to apply app-wide." },
      { task: "Upload a logo & auto-fill colours", steps: "In Settings → Appearance, choose an image (transparent PNG/SVG recommended). Colours are suggested automatically from the logo — adjust them if needed, then Save appearance. Use “Suggest colours” to re-run it on the current logo." },
      { task: "Resize the logo", steps: "Drag the “Logo size” slider to scale the logo up or down; the preview updates live, and Save appearance stores it." },
      { task: "Tune SLA & exception thresholds", steps: "In Settings → Metrics & Thresholds, set the SLA wait target and SLA service target (a ticket meets SLA only when both are within target), plus the exception threshold (minutes). Save thresholds and the dashboards recalculate automatically." },
    ],
  },
]

export default async function HelpPage() {
  const user = await requireUser()
  const groups = HOWTO.filter((g) => {
    if (g.roles === "manageUsers") return canManageUsers(user.role)
    if (g.roles === "settings") return canChangeAppSettings(user.role)
    return true
  })

  return (
    <DashboardShell user={user} title="Help & Information">
      <div className="grid gap-4 px-4 lg:grid-cols-2 lg:px-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-primary">Key Metrics</CardTitle>
            <CardDescription>What each metric on the dashboards means.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3 text-sm leading-relaxed">
              {METRICS.map((m) => (
                <div key={m.term}>
                  <dt className="inline font-semibold text-primary">{m.term}</dt>
                  <dd className="inline text-foreground"> — {m.desc}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Using the dashboard</CardTitle>
            <CardDescription>Answers to common questions.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="space-y-4 text-sm leading-relaxed">
              {FAQ.map((f) => (
                <div key={f.q}>
                  <dt className="font-semibold">{f.q}</dt>
                  <dd className="mt-0.5 text-muted-foreground">{f.a}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        {/* Full how-to summary of every function, spanning both columns. */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center gap-2">
              <span aria-hidden className="h-4 w-1 rounded-full bg-primary" />
              <CardTitle className="text-primary">How to do everything</CardTitle>
            </div>
            <CardDescription>
              A step-by-step summary of every function on this dashboard{groups.some((g) => g.roles) ? ", including the admin tools available to you" : ""}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
              {groups.map((g) => (
                <section key={g.area} className="break-inside-avoid">
                  <h3 className="mb-2 border-l-2 border-primary pl-2 text-sm font-semibold">{g.area}</h3>
                  <dl className="space-y-2.5 text-sm leading-relaxed">
                    {g.items.map((it) => (
                      <div key={it.task}>
                        <dt className="font-medium text-foreground">{it.task}</dt>
                        <dd className="mt-0.5 text-muted-foreground">{it.steps}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardShell>
  )
}
