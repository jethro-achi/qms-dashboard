"use client"

import * as React from "react"
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { CategoryFilter } from "./category-filter"
import { useCategorySelection } from "./use-category-selection"
import { ExportButton, type ExportColumn } from "./export-button"

export interface InteractiveSeries {
  key: string
  label: string
  color: string
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s
}

/**
 * Interactive vertical bar card (shadcn "bar chart - interactive" style): the
 * header carries a stat tile per series that doubles as a toggle for which
 * series the bars show; the big number is the series' aggregate. Keeps the
 * per-visual category filter + Excel export the report cards rely on. Both the
 * stats and the chart reflect the current category selection.
 *
 *  - aggregate "sum" — counts (traffic, ratings): header shows the total.
 *  - aggregate "avg" — averages/scores (minutes, NPS): header shows the mean.
 */
export function InteractiveBarCard({
  title,
  description,
  data,
  series,
  xKey = "label",
  valueSuffix = "",
  aggregate = "sum",
  exportColumns,
  height = 250,
}: {
  title: string
  description?: string
  data: readonly object[]
  series: InteractiveSeries[]
  xKey?: string
  valueSuffix?: string
  aggregate?: "sum" | "avg"
  exportColumns?: ExportColumn[]
  height?: number
}) {
  const rows = data as ReadonlyArray<Record<string, unknown>>
  const labels = rows.map((d) => String(d[xKey] ?? ""))
  const { selected, setSelected } = useCategorySelection(labels)
  const shown = rows.filter((d) => selected.has(String(d[xKey] ?? "")))

  const multi = series.length > 1
  const [active, setActive] = React.useState<string>(series[0]?.key ?? "")
  const activeKey = series.some((s) => s.key === active) ? active : series[0]?.key ?? ""

  const config: ChartConfig = Object.fromEntries(
    series.map((s) => [s.key, { label: s.label, color: s.color }]),
  )

  const stats = React.useMemo(() => {
    const out: Record<string, number> = {}
    for (const s of series) {
      const nums = shown.map((d) => Number(d[s.key]) || 0)
      const sum = nums.reduce((a, b) => a + b, 0)
      out[s.key] = aggregate === "avg" ? (nums.length ? sum / nums.length : 0) : sum
    }
    return out
  }, [shown, series, aggregate])

  const fmtStat = (v: number) =>
    aggregate === "avg" ? `${Math.round(v * 10) / 10}${valueSuffix}` : `${Math.round(v).toLocaleString()}${valueSuffix}`

  return (
    <Card className="py-0">
      <CardHeader className="flex flex-col items-stretch border-b p-0! sm:flex-row">
        <div className="flex flex-1 flex-col justify-center gap-1 px-6 pt-4 pb-3 sm:py-4!">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base font-medium">{title}</CardTitle>
            <div className="flex items-center gap-0.5">
              <CategoryFilter labels={labels} selected={selected} onChange={setSelected} />
              {exportColumns && <ExportButton title={title} columns={exportColumns} rows={shown} />}
            </div>
          </div>
          {description && <CardDescription>{description}</CardDescription>}
        </div>

        <div className="flex">
          {series.map((s) => {
            const isActive = activeKey === s.key
            const Tag = multi ? "button" : "div"
            return (
              <Tag
                key={s.key}
                {...(multi
                  ? { "data-active": isActive, onClick: () => setActive(s.key), type: "button" as const }
                  : {})}
                className={
                  "relative z-30 flex flex-1 flex-col justify-center gap-1 border-t px-6 py-3 text-left even:border-l sm:min-w-36 sm:border-t-0 sm:border-l sm:px-6 sm:py-4" +
                  (multi ? " data-[active=true]:bg-muted/50" : "")
                }
              >
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="size-2 rounded-[2px]" style={{ backgroundColor: s.color }} />
                  {s.label}
                </span>
                <span className="text-lg leading-none font-bold tabular-nums sm:text-2xl">
                  {fmtStat(stats[s.key] ?? 0)}
                </span>
              </Tag>
            )
          })}
        </div>
      </CardHeader>

      <CardContent className="px-2 sm:p-6">
        {shown.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">No data for these filters.</p>
        ) : (
          <ChartContainer config={config} className="aspect-auto w-full" style={{ height }}>
            <BarChart accessibilityLayer data={shown} margin={{ left: 12, right: 12 }}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey={xKey}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={16}
                tickFormatter={(v: string) => truncate(String(v), 12)}
              />
              <ChartTooltip content={<ChartTooltipContent className="w-[160px]" />} />
              <Bar dataKey={activeKey} fill={`var(--color-${activeKey})`} radius={4} maxBarSize={48} />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}
