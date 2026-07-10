// components/dashboard-shell.tsx
// Shared authenticated layout: sidebar (role-gated) + header. Server component;
// pages pass the resolved session user and their title. Keeps every signed-in
// screen visually consistent and avoids repeating the SidebarProvider wiring.
import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/site-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { UnreadProvider } from "@/components/messages/unread-context"
import { MessageNotifier } from "@/components/messages/message-notifier"
import { SessionGuard } from "@/components/session-guard"
import type { SessionUser } from "@/lib/session"
import { hasLogo, logoVersion } from "@/lib/branding"
import { getLogoScale } from "@/lib/settings"

export async function DashboardShell({
  user,
  title,
  children,
}: {
  user: SessionUser
  title: string
  children: React.ReactNode
}) {
  const logoSrc = hasLogo() ? `/api/branding/logo?v=${logoVersion()}` : null
  const logoScale = await getLogoScale()
  return (
    <UnreadProvider>
      <SidebarProvider
        style={
          {
            "--sidebar-width": "calc(var(--spacing) * 72)",
            "--header-height": "calc(var(--spacing) * 12)",
          } as React.CSSProperties
        }
      >
        <AppSidebar
          variant="inset"
          user={{ name: user.name, email: user.email, role: user.role }}
          logoSrc={logoSrc}
          logoScale={logoScale}
        />
        <SidebarInset>
          <SiteHeader title={title} />
          <div className="flex flex-1 flex-col">
            <div className="@container/main flex flex-1 flex-col gap-2">
              <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">{children}</div>
            </div>
          </div>
        </SidebarInset>
        <MessageNotifier />
        <SessionGuard />
      </SidebarProvider>
    </UnreadProvider>
  )
}
