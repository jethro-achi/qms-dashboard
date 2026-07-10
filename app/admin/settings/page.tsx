import { DashboardShell } from "@/components/dashboard-shell"
import { ThemeSettings } from "@/components/admin/theme-settings"
import { requireSuperAdmin } from "@/lib/session"
import { getAppTheme, getAppMetrics, getLogoScale } from "@/lib/settings"
import { hasLogo } from "@/lib/branding"

export const dynamic = "force-dynamic"

export default async function SettingsPage() {
  const user = await requireSuperAdmin()
  const [theme, metrics, logoScale] = await Promise.all([getAppTheme(), getAppMetrics(), getLogoScale()])
  return (
    <DashboardShell user={user} title="Settings">
      <ThemeSettings
        initialTheme={theme}
        initialMetrics={metrics}
        initialHasLogo={hasLogo()}
        initialLogoScale={logoScale}
      />
    </DashboardShell>
  )
}
