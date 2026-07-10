import { DashboardShell } from "@/components/dashboard-shell"
import { MessagesClient } from "@/components/messages/messages-client"
import { requireUser } from "@/lib/session"

export const dynamic = "force-dynamic"

export default async function MessagesPage() {
  const user = await requireUser()
  return (
    <DashboardShell user={user} title="Messages">
      <MessagesClient />
    </DashboardShell>
  )
}
