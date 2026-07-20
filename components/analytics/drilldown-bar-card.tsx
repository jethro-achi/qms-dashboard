"use client"

import * as React from "react"
import { ChevronRightIcon, Loader2Icon, RotateCcwIcon, LayersIcon } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SimpleBarChart, type BarDatum } from "./simple-bar-chart"
import { ExportButton, type ExportColumn } from "./export-button"
import {
  DIMENSION_LABELS, DRILL_ORDER,
  type BreakdownDimension, type BreakdownMetric, type BreakdownRow,
} from "@/lib/analytics/breakdown-shared"

/**
 * A bar-chart card whose funnel actually DRILLS: pick another dimension to
 * re-group the same metric (Branch -> Service -> Agent -> ...), or click a bar to
 * narrow into that category and break down what's left. Every re-group is a
 * server round-trip (RLS-scoped) — raw rows never reach the browser. A breadcrumb
 * shows the path; each crumb pops back to that level.
 */
export function DrilldownBarCard({
  title,
  metric,
  baseDimension,
  initialRows,
  valueSuffix = "",
  orientation = "vertical",
  labelWidth,
  exportColumns,
}: {
  title: string
  metric: BreakdownMetric
  baseDimension: BreakdownDimension
  initialRows: BreakdownRow[]
  valueSuffix?: string
  orientation?: "horizontal" | "vertical"
  labelWidth?: number
  exportColumns?: ExportColumn[]
}) {
  // The categories drilled INTO (each carries its dimension + key + display label).
  const [path, setPath] = React.useState<{ dimension: BreakdownDimension; key: string; label: string }[]>([])
  const [viewDim, setViewDim] = React.useState<BreakdownDimension>(baseDimension)
  const [rows, setRows] = React.useState<BreakdownRow[]>(initialRows)
  const [loading, setLoading] = React.useState(false)
  const [err, setErr] = React.useState<string | null>(null)

  const atBase = path.length === 0 && viewDim === baseDimension
  const usedDims = new Set(path.map((p) => p.dimension))
  const available = DRILL_ORDER.filter((d) => !usedDims.has(d))
  // Something to click a bar INTO only if another dimension remains.
  const canDrillInto = available.some((d) => d !== viewDim)

  const load = React.useCallback(
    async (nextPath: { dimension: BreakdownDimension; key: string }[], dim: BreakdownDimension) => {
      setLoading(true); setErr(null)
      try {
        const res = await fetch("/api/analytics/breakdown", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ metric, dimension: dim, drill: nextPath.map((p) => ({ dimension: p.dimension, key: p.key })) }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) { setErr(data?.error ?? "Could not load breakdown."); setRows([]); return }
        setRows(data.rows ?? [])
      } catch { setErr("Could not load breakdown."); setRows([]) }
      finally { setLoading(false) }
    },
    [metric],
  )

  // Re-group the current level by a different dimension.
  function viewBy(dim: BreakdownDimension) {
    if (dim === viewDim) return
    setViewDim(dim)
    if (path.length === 0 && dim === baseDimension) { setRows(initialRows); setErr(null); return }
    void load(path, dim)
  }

  // Click a bar: narrow into that category, then auto-advance to the next
  // available dimension so you immediately see it broken down.
  function drillInto(row: BarDatum) {
    if (!row.key) return
    const nextPath = [...path, { dimension: viewDim, key: row.key, label: row.label }]
    const nextDim = DRILL_ORDER.find((d) => !nextPath.some((p) => p.dimension === d))
    if (!nextDim) return
    setPath(nextPath); setViewDim(nextDim)
    void load(nextPath, nextDim)
  }

  // Pop the breadcrumb back to a given depth (0 = the base view).
  function popTo(depth: number) {
    const nextPath = path.slice(0, depth)
    const nextDim = depth === 0
      ? baseDimension
      : (DRILL_ORDER.find((d) => !nextPath.some((p) => p.dimension === d)) ?? baseDimension)
    setPath(nextPath); setViewDim(nextDim)
    if (nextPath.length === 0 && nextDim === baseDimension) { setRows(initialRows); setErr(null) }
    else void load(nextPath, nextDim)
  }

  const data: BarDatum[] = rows.map((r) => ({ label: r.label, value: r.value, key: r.key }))
  const exportCols = exportColumns ?? [
    { key: "label", header: DIMENSION_LABELS[viewDim] },
    { key: "value", header: title },
  ]

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2 space-y-0 pb-2">
        <div className="min-w-0">
          <CardTitle className="text-base font-medium">{title}</CardTitle>
          {/* Breadcrumb: base dimension, each drilled category, then "by <dim>". */}
          <div className="mt-1 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-xs text-muted-foreground">
            <button className="hover:text-foreground" onClick={() => popTo(0)}>{DIMENSION_LABELS[baseDimension]}</button>
            {path.map((p, i) => (
              <span key={`${p.dimension}-${i}`} className="flex items-center gap-1">
                <ChevronRightIcon className="h-3 w-3" />
                <button className="max-w-32 truncate hover:text-foreground" onClick={() => popTo(i + 1)} title={p.label}>{p.label}</button>
              </span>
            ))}
            {!atBase && (
              <span className="flex items-center gap-1">
                <ChevronRightIcon className="h-3 w-3" />
                <span className="text-foreground">by {DIMENSION_LABELS[viewDim]}</span>
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {!atBase && (
            <Button variant="ghost" size="sm" onClick={() => popTo(0)} title="Reset drill-down">
              <RotateCcwIcon className="h-4 w-4" />
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="sm" title="Break down by dimension" />}>
              {loading ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <LayersIcon className="h-4 w-4" />}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Break down by</div>
              <DropdownMenuSeparator />
              {available.map((d) => (
                <DropdownMenuItem key={d} onClick={() => viewBy(d)} disabled={d === viewDim}>
                  {DIMENSION_LABELS[d]}{d === viewDim ? " (current)" : ""}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <ExportButton title={title} columns={exportCols} rows={rows} />
        </div>
      </CardHeader>
      <CardContent>
        {err ? (
          <p className="py-10 text-center text-sm text-destructive">{err}</p>
        ) : (
          <>
            <SimpleBarChart
              data={data}
              orientation={orientation}
              valueSuffix={valueSuffix}
              labelWidth={labelWidth}
              onBarClick={canDrillInto ? drillInto : undefined}
            />
            {canDrillInto && data.length > 0 && (
              <p className="mt-1 text-center text-xs text-muted-foreground">Tip: click a bar to drill into it.</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
