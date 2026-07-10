import { ComingSoon } from "@/components/coming-soon"
import { DashboardShell } from "@/components/dashboard-shell"
import { requireUser } from "@/lib/session"

export const dynamic = "force-dynamic"

export default async function AccountPage() {
  const user = await requireUser()
  return (
    <DashboardShell user={user} title="Account">
      <ComingSoon
        title="Your account"
        description="Profile and password management."
      />
    </DashboardShell>
  )
}
