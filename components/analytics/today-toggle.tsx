"use client"

import { useRouter } from "next/navigation"
import { CalendarCheck2Icon } from "lucide-react"
import { Toggle } from "@/components/ui/toggle"
import { FILTER_COOKIE, type AnalyticsFilters } from "@/lib/analytics/filters"

/**
 * "Show today's data" toggle. Writes the shared filter cookie so the choice
 * persists across pages (like every other filter). Turning it on clears any
 * explicit date range so Today mode wins; turning it off reveals history.
 */
export function TodayToggle({
  active,
  current,
}: {
  active: boolean
  current: AnalyticsFilters
}) {
  const router = useRouter()

  function set(on: boolean) {
    const next: AnalyticsFilters = { ...current, today: on }
    if (on) {
      delete next.dateFrom
      delete next.dateTo
    }
    document.cookie = `${FILTER_COOKIE}=${encodeURIComponent(JSON.stringify(next))}; path=/; max-age=${60 * 60 * 24 * 30}; samesite=lax`
    router.refresh()
  }

  return (
    <Toggle
      variant="outline"
      pressed={active}
      onPressedChange={set}
      aria-label="Show today's data"
      className="data-[pressed]:bg-primary data-[pressed]:text-primary-foreground"
    >
      <CalendarCheck2Icon />
      Show today&apos;s data
    </Toggle>
  )
}
