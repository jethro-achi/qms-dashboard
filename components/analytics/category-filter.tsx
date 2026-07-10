"use client"

import { ListFilterIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

/**
 * Per-visual filter: pick which categories a chart shows. Slices already-loaded
 * data client-side (no re-query); the parent applies the selection to both the
 * chart and its export.
 */
export function CategoryFilter({
  labels,
  selected,
  onChange,
}: {
  labels: string[]
  selected: Set<string>
  onChange: (next: Set<string>) => void
}) {
  const active = selected.size < labels.length

  function toggle(label: string) {
    const next = new Set(selected)
    if (next.has(label)) next.delete(label)
    else next.add(label)
    onChange(next)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label="Filter this visual"
            title="Filter this visual"
            className={active ? "text-primary" : undefined}
          />
        }
      >
        <ListFilterIcon className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 w-56 overflow-auto">
        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Show categories</div>
        <div className="flex gap-1 px-1 pb-1">
          <DropdownMenuItem
            className="flex-1 justify-center"
            onClick={() => onChange(new Set(labels))}
          >
            All
          </DropdownMenuItem>
          <DropdownMenuItem className="flex-1 justify-center" onClick={() => onChange(new Set())}>
            None
          </DropdownMenuItem>
        </div>
        <DropdownMenuSeparator />
        {labels.map((label) => (
          <DropdownMenuCheckboxItem
            key={label}
            checked={selected.has(label)}
            onCheckedChange={() => toggle(label)}
            closeOnClick={false}
          >
            <span className="truncate">{label}</span>
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
