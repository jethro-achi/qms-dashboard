import { DashboardShell } from "@/components/dashboard-shell"
import { AuditViewer } from "@/components/admin/audit-viewer"
import { requireSuperAdmin } from "@/lib/session"
import { listAuditEntries, verifyChain } from "@/lib/audit"

export const dynamic = "force-dynamic"

export default async function AuditPage() {
  const user = await requireSuperAdmin()
  const [{ entries, total }, integrity] = await Promise.all([
    listAuditEntries({ limit: 100, offset: 0 }),
    verifyChain(),
  ])
  return (
    <DashboardShell user={user} title="Audit log">
      <AuditViewer initialEntries={entries} initialTotal={total} integrity={integrity} />
    </DashboardShell>
  )
}
