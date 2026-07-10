"use client"

import * as React from "react"
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ExportButton } from "./export-button"
import type { TrafficPoint } from "@/lib/analytics/home"

const TITLE = "Total Traffic"

const config = {
  total: { label: "Total", color: "var(--chart-1)" },
  served: { label: "Served", color: "var(--chart-2)" },
} satisfies ChartConfig

const RANGES = [
  { value: "90d", label: "Last 3 months", days: 90 },
  { value: "30d", label: "Last 30 days", days: 30 },
  { value: "7d", label: "Last 7 days", days: 7 },
] as const

function fmtDate(d: string) {
  return new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

export function TrafficAreaChart({ data }: { data: TrafficPoint[] }) {
  const [range, setRange] = React.useState<string>("90d")

  const filtered = React.useMemo(() => {
    const days = RANGES.find((r) => r.value === range)?.days ?? 90
    if (data.length === 0) return data
    // Anchor to the latest data point so the toggle works even on historical data.
    const last = new Date(`${data[data.length - 1].date}T00:00:00`)
    const from = new Date(last)
    from.setDate(from.getDate() - (days - 1))
    return data.filter((p) => new Date(`${p.date}T00:00:00`) >= from)
  }, [data, range])

  const total = filtered.reduce((s, d) => s + d.total, 0)
  const rangeLabel = RANGES.find((r) => r.value === range)?.label ?? "Last 3 months"

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>{TITLE}</CardTitle>
        <CardDescription>
          <span className="hidden @[540px]/card:block">{total.toLocaleString()} tickets · {rangeLabel.toLowerCase()}</span>
          <span className="@[540px]/card:hidden">{rangeLabel}</span>
        </CardDescription>
        <CardAction className="flex items-center gap-2">
          <ToggleGroup
            value={[range]}
            onValueChange={(v: string[]) => {
              const next = v[v.length - 1]
              if (next) setRange(next)
            }}
            variant="outline"
            className="hidden @[767px]/card:flex"
          >
            {RANGES.map((r) => (
              <ToggleGroupItem key={r.value} value={r.value} className="px-3">
                {r.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Select items={RANGES.map((r) => ({ value: r.value, label: r.label }))} value={range} onValueChange={(v) => setRange((v as string) ?? "90d")}>
            <SelectTrigger className="flex w-40 @[767px]/card:hidden" aria-label="Select range">
              <SelectValue placeholder="Last 3 months" />
            </SelectTrigger>
            <SelectContent>
              {RANGES.map((r) => (
                <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ExportButton
            title={TITLE}
            columns={[
              { key: "date", header: "Date" },
              { key: "total", header: "Total" },
              { key: "served", header: "Served" },
            ]}
            rows={filtered}
          />
        </CardAction>
      </CardHeader>
      <CardContent>
        {filtered.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">No traffic for this range.</p>
        ) : (
          <ChartContainer config={config} className="aspect-auto h-[240px] w-full">
            <AreaChart data={filtered} margin={{ left: 4, right: 8 }}>
              <defs>
                <linearGradient id="fillTotal" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-total)" stopOpacity={0.7} />
                  <stop offset="95%" stopColor="var(--color-total)" stopOpacity={0.06} />
                </linearGradient>
                <linearGradient id="fillServed" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-served)" stopOpacity={0.7} />
                  <stop offset="95%" stopColor="var(--color-served)" stopOpacity={0.06} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} tickFormatter={fmtDate} />
              <YAxis tickLine={false} axisLine={false} width={28} />
              <ChartTooltip
                cursor={false}
                content={<ChartTooltipContent labelFormatter={(v) => fmtDate(String(v))} indicator="dot" />}
              />
              <ChartLegend content={<ChartLegendContent />} />
              <Area dataKey="total" type="natural" fill="url(#fillTotal)" stroke="var(--color-total)" stackId="a" />
              <Area dataKey="served" type="natural" fill="url(#fillServed)" stroke="var(--color-served)" stackId="b" />
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}
