import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { DataStatusBar } from "@/components/analytics/data-status-bar"
import { ModeToggle } from "@/components/mode-toggle"

export function SiteHeader({ title = "Dashboard" }: { title?: string }) {
  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mx-2 h-4 data-vertical:self-auto"
        />
        {/* Primary accent bar before the page title for a touch of brand colour. */}
        <span aria-hidden className="h-4 w-1 rounded-full bg-primary" />
        <h1 className="text-base font-medium">{title}</h1>
        <DataStatusBar />
        <ModeToggle />
      </div>
    </header>
  )
}
