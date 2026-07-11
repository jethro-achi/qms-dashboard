"use client"

import { signOut } from "next-auth/react"

import {
  Avatar,
  AvatarFallback,
} from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { EllipsisVerticalIcon, CircleUserRoundIcon, LogOutIcon } from "lucide-react"
import { roleDescription, type Role } from "@/lib/rbac"

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  const letters = parts.slice(0, 2).map((p) => p[0] ?? "").join("")
  return letters.toUpperCase() || "?"
}

export function NavUser({
  user,
}: {
  user: {
    name: string
    email: string
    role: Role
    branchLabel: string
  }
}) {
  const { isMobile } = useSidebar()
  // Branch ops -> "{Branch} Branch Operations"; admin -> "Administrator";
  // super admin -> null (name only). Guard the no-branch sentinel.
  const description = roleDescription(
    user.role,
    user.branchLabel === "No branch assigned" ? null : user.branchLabel,
  )
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton size="lg" className="aria-expanded:bg-muted" />
            }
          >
            <Avatar className="size-8 rounded-lg">
              <AvatarFallback className="rounded-lg">{initials(user.name)}</AvatarFallback>
            </Avatar>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">{user.name}</span>
              {description && (
                <span className="truncate text-xs text-foreground/70">{description}</span>
              )}
            </div>
            <EllipsisVerticalIcon className="ml-auto size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="min-w-56"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="p-0 font-normal">
                <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                  <Avatar className="size-8">
                    <AvatarFallback className="rounded-lg">{initials(user.name)}</AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">{user.name}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {user.email}
                    </span>
                  </div>
                </div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            {/* Self-service account is the super admin's only; branch ops and
                dashboard admins are provisioned/managed by the super admin. */}
            {user.role === "SUPER_ADMIN" && (
              <>
                <DropdownMenuItem render={<a href="/account" />}>
                  <CircleUserRoundIcon />
                  Account
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem
              onClick={async () => {
                // Clear the session cookie without letting next-auth build the
                // post-logout URL: in the standalone Docker image the server's
                // hostname is 0.0.0.0, which it would otherwise hand back as an
                // unreachable redirect (ERR_ADDRESS_INVALID). Redirect ourselves,
                // relative to whatever origin the browser is actually on.
                await signOut({ redirect: false })
                window.location.href = "/login"
              }}
            >
              <LogOutIcon />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
