"use client"

import * as React from "react"

import { NavMain } from "@/components/nav-main"
import { NavSecondary } from "@/components/nav-secondary"
import { NavUser } from "@/components/nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import {
  LayoutDashboardIcon,
  Building2Icon,
  GaugeIcon,
  TrophyIcon,
  TriangleAlertIcon,
  MessageSquareHeartIcon,
  RefreshCwIcon,
  FileDownIcon,
  MessagesSquareIcon,
  UsersIcon,
  Settings2Icon,
  CircleHelpIcon,
  ActivitySquareIcon,
  ScrollTextIcon,
} from "lucide-react"
import { canChangeAppSettings, canManageUsers, type Role } from "@/lib/rbac"
import { MessagesNavBadge } from "@/components/messages/messages-nav-badge"

export interface SidebarUser {
  name: string
  email: string
  role: Role
}

// Nav is derived from the signed-in role. Branch-scoped roles (BRANCH_OPS)
// still see the analytics pages — the DATA behind them is scoped server-side
// by the branch filter; only the super admin sees the admin tools.
function navForRole(role: Role) {
  const items: { title: string; url: string; icon: React.ReactNode; badge?: React.ReactNode }[] = [
    { title: "Home", url: "/dashboard", icon: <LayoutDashboardIcon /> },
    { title: "Branch Overview", url: "/branch-overview", icon: <Building2Icon /> },
    { title: "Productivity", url: "/productivity", icon: <GaugeIcon /> },
    { title: "Leaderboard", url: "/leaderboard", icon: <TrophyIcon /> },
    { title: "Exceptions", url: "/exceptions", icon: <TriangleAlertIcon /> },
    { title: "Feedback", url: "/feedback", icon: <MessageSquareHeartIcon /> },
    { title: "Data Refresh", url: "/data-refresh", icon: <RefreshCwIcon /> },
    { title: "Messages", url: "/messages", icon: <MessagesSquareIcon />, badge: <MessagesNavBadge /> },
  ]
  // Reports are for dashboard users, not the super admin.
  if (role !== "SUPER_ADMIN") {
    items.splice(7, 0, { title: "Reports", url: "/reports", icon: <FileDownIcon /> })
  }
  if (canManageUsers(role)) {
    items.push({ title: "User management", url: "/admin/users", icon: <UsersIcon /> })
    items.push({ title: "Audit log", url: "/admin/audit", icon: <ScrollTextIcon /> })
  }
  if (canChangeAppSettings(role)) {
    items.push({ title: "Settings", url: "/admin/settings", icon: <Settings2Icon /> })
  }
  return items
}

export function AppSidebar({
  user,
  logoSrc,
  logoScale = 100,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  user: SidebarUser
  logoSrc?: string | null
  logoScale?: number
}) {
  // Base logo height is 48px (max-h-12); the super admin's size setting scales it.
  const logoHeight = Math.round((48 * logoScale) / 100)
  const navMain = navForRole(user.role)
  const navSecondary = [
    { title: "Get help", url: "/help", icon: <CircleHelpIcon /> },
  ]

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="h-auto data-[slot=sidebar-menu-button]:p-1.5!"
              render={<a href="/dashboard" />}
            >
              {logoSrc ? (
                // Client logo (transparent). eslint-disable: intentional <img>
                // so it works with the file-served, non-optimized branding route.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoSrc} alt="Logo" style={{ height: logoHeight }} className="w-auto object-contain" />
              ) : (
                <>
                  <ActivitySquareIcon className="size-5!" />
                  <span className="text-base font-semibold">QMS Analytics</span>
                </>
              )}
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navMain} />
        <NavSecondary items={navSecondary} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
    </Sidebar>
  )
}
