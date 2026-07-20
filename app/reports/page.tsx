import { redirect } from "next/navigation"

import { DashboardShell } from "@/components/dashboard-shell"
import { ReportsClient } from "@/components/reports/reports-client"
import { SchedulesManager } from "@/components/reports/schedules-manager"
import { requireUser, toPrincipal } from "@/lib/session"
import { getDataRange } from "@/lib/reports/queries"
import { listPeriods, type PeriodType, type PeriodOption } from "@/lib/reports/period"
import { listSchedules, listGeneratedReports } from "@/lib/reports/schedule"
import { isMailConfigured } from "@/lib/reports/mailer"

export const dynamic = "force-dynamic"

export default async function ReportsPage() {
  const user = await requireUser()
  // Reports are for dashboard users, not the super admin.
  if (user.role === "SUPER_ADMIN") redirect("/dashboard")

  let periods: Record<PeriodType, PeriodOption[]> = { daily: [], monthly: [], quarterly: [], annual: [] }
  let dataRange: { min: string; max: string } | null = null
  let error: string | null = null
  try {
    const { min, max } = await getDataRange(toPrincipal(user))
    periods = listPeriods(min, max)
    const iso = (d: Date) => d.toISOString().slice(0, 10)
    dataRange = { min: iso(min), max: iso(max) }
  } catch (e) {
    error = (e as Error).message
  }

  const [schedules, reports] = await Promise.all([
    listSchedules(user.id).catch(() => []),
    listGeneratedReports(user.id).catch(() => []),
  ])

  return (
    <DashboardShell user={user} title="Reports">
      <div className="grid gap-4 px-4 lg:px-6">
        <ReportsClient periods={periods} error={error} dataRange={dataRange} />
        <SchedulesManager
          initialSchedules={schedules}
          initialReports={reports}
          mailConfigured={isMailConfigured()}
          userEmail={user.email}
        />
      </div>
    </DashboardShell>
  )
}
