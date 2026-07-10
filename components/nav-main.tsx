"use client"

import { usePathname } from "next/navigation"

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"

export function NavMain({
  items,
}: {
  items: {
    title: string
    url: string
    icon?: React.ReactNode
    badge?: React.ReactNode
  }[]
}) {
  const pathname = usePathname()
  return (
    <SidebarGroup>
      <SidebarGroupContent className="flex flex-col gap-2">
        <SidebarMenu>
          {items.map((item) => {
            // Highlight the current section with a touch of the primary colour.
            const active =
              pathname === item.url ||
              (item.url !== "/dashboard" && pathname.startsWith(`${item.url}/`))
            return (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton
                  tooltip={item.title}
                  render={<a href={item.url} />}
                  className={cn(
                    active &&
                      "bg-primary/10 font-medium text-primary hover:bg-primary/15 hover:text-primary [&_svg]:text-primary"
                  )}
                >
                  {item.icon}
                  <span>{item.title}</span>
                  {item.badge}
                </SidebarMenuButton>
              </SidebarMenuItem>
            )
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
