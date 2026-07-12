"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { SlidersHorizontal, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { FILTER_COOKIE, type AnalyticsFilters } from "@/lib/analytics/filters"
import type { FilterOptions } from "@/lib/analytics/queries"

function writeCookie(filters: AnalyticsFilters) {
  const value = encodeURIComponent(JSON.stringify(filters))
  document.cookie = `${FILTER_COOKIE}=${value}; path=/; max-age=${60 * 60 * 24 * 30}; samesite=lax`
}
function clearCookie() {
  document.cookie = `${FILTER_COOKIE}=; path=/; max-age=0; samesite=lax`
}

function toggle(set: Set<string>, id: string): Set<string> {
  const next = new Set(set)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

export function FilterBar({
  options,
  current,
  activeCount,
}: {
  options: FilterOptions
  current: AnalyticsFilters
  activeCount: number
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)

  const [dateFrom, setDateFrom] = React.useState(current.dateFrom ?? "")
  const [dateTo, setDateTo] = React.useState(current.dateTo ?? "")
  const [branchIds, setBranchIds] = React.useState<Set<string>>(new Set(current.branchIds ?? []))
  const [queueIds, setQueueIds] = React.useState<Set<string>>(new Set(current.queueIds ?? []))
  const [statuses, setStatuses] = React.useState<Set<string>>(new Set(current.statuses ?? []))
  const [serviceNames, setServiceNames] = React.useState<Set<string>>(new Set(current.serviceNames ?? []))
  const [staffIds, setStaffIds] = React.useState<Set<string>>(new Set(current.staffIds ?? []))

  function apply() {
    const filters: AnalyticsFilters = {}
    if (dateFrom) filters.dateFrom = dateFrom
    if (dateTo) filters.dateTo = dateTo
    if (branchIds.size) filters.branchIds = [...branchIds]
    if (queueIds.size) filters.queueIds = [...queueIds]
    if (statuses.size) filters.statuses = [...statuses]
    if (serviceNames.size) filters.serviceNames = [...serviceNames]
    if (staffIds.size) filters.staffIds = [...staffIds]
    // Preserve the "Show today's data" choice; an explicit date range below is
    // what turns Today mode off (handled server-side in withTodayResolved).
    if (current.today !== undefined) filters.today = current.today
    writeCookie(filters)
    setOpen(false)
    router.refresh()
  }

  function clearAll() {
    clearCookie()
    setDateFrom("")
    setDateTo("")
    setBranchIds(new Set())
    setQueueIds(new Set())
    setStatuses(new Set())
    setServiceNames(new Set())
    setStaffIds(new Set())
    setOpen(false)
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setOpen((o) => !o)}>
          <SlidersHorizontal className="h-4 w-4" />
          Show Filters
          {activeCount > 0 && <Badge className="ml-1 h-5 px-1.5">{activeCount}</Badge>}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={clearAll}
          disabled={activeCount === 0}
          className="text-muted-foreground"
        >
          <X className="h-4 w-4" />
          Clear Filters
        </Button>
      </div>

      {open && (
        <Card>
          <CardContent className="grid gap-6 py-5 md:grid-cols-2 lg:grid-cols-4">
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Date range</span>
              <label className="text-xs text-muted-foreground">From</label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              <label className="text-xs text-muted-foreground">To</label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>

            <CheckGroup
              title="Branch"
              items={options.branches.map((b) => ({ id: b.id, label: b.name }))}
              selected={branchIds}
              onToggle={(id) => setBranchIds((s) => toggle(s, id))}
            />
            <CheckGroup
              title="Service queue"
              items={options.queues.map((q) => ({ id: q.id, label: q.name }))}
              selected={queueIds}
              onToggle={(id) => setQueueIds((s) => toggle(s, id))}
            />
            <CheckGroup
              title="Status"
              items={options.statuses.map((s) => ({ id: s, label: s }))}
              selected={statuses}
              onToggle={(id) => setStatuses((s) => toggle(s, id))}
            />
            <CheckGroup
              title="Service"
              items={options.services.map((s) => ({ id: s, label: s }))}
              selected={serviceNames}
              onToggle={(id) => setServiceNames((s) => toggle(s, id))}
            />
            <CheckGroup
              title="Staff member"
              items={options.staff.map((s) => ({ id: s.id, label: s.name }))}
              selected={staffIds}
              onToggle={(id) => setStaffIds((s) => toggle(s, id))}
            />

            <div className="flex items-center gap-2 md:col-span-2 lg:col-span-4">
              <Button size="sm" onClick={apply}>Apply filters</Button>
              <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// Threshold above which a group gets its own search box, so large datasets
// (services, staff, many branches) stay usable.
const SEARCHABLE_THRESHOLD = 8

function CheckGroup({
  title,
  items,
  selected,
  onToggle,
}: {
  title: string
  items: { id: string; label: string }[]
  selected: Set<string>
  onToggle: (id: string) => void
}) {
  const [q, setQ] = React.useState("")
  const searchable = items.length > SEARCHABLE_THRESHOLD
  const shown = React.useMemo(() => {
    if (!searchable || !q.trim()) return items
    const needle = q.trim().toLowerCase()
    return items.filter((i) => i.label.toLowerCase().includes(needle))
  }, [items, q, searchable])

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</span>
      {searchable && (
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Search ${title.toLowerCase()}…`}
          className="h-8"
        />
      )}
      <div className="flex max-h-40 flex-col gap-2 overflow-y-auto pr-1">
        {items.length === 0 && <span className="text-xs text-muted-foreground">None</span>}
        {items.length > 0 && shown.length === 0 && (
          <span className="text-xs text-muted-foreground">No matches</span>
        )}
        {shown.map((item) => (
          <label key={item.id} className="flex items-center gap-2 text-sm">
            <Checkbox checked={selected.has(item.id)} onCheckedChange={() => onToggle(item.id)} />
            <span className="truncate">{item.label}</span>
          </label>
        ))}
      </div>
    </div>
  )
}
