import { DashboardShell } from "@/components/dashboard-shell"
import { UsersManager } from "@/components/admin/users-manager"
import { ReportError } from "@/components/analytics/report-bits"
import { requireSuperAdmin } from "@/lib/session"
import { listUsers } from "@/lib/users"
import { getFilterOptions } from "@/lib/analytics/queries"

export const dynamic = "force-dynamic"

export default async function UsersAdminPage() {
  const user = await requireSuperAdmin()

  let body: React.ReactNode
  try {
    const [users, options] = await Promise.all([listUsers(), getFilterOptions()])
    body = <UsersManager users={users} branches={options.branches} currentUserId={user.id} />
  } catch (error) {
    body = (
      <div className="px-4 lg:px-6">
        <ReportError error={error} />
      </div>
    )
  }

  return (
    <DashboardShell user={user} title="User management">
      {body}
    </DashboardShell>
  )
}
