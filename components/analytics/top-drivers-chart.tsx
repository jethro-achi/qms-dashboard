"use client"

import * as React from "react"
import { TrendingUp, TrendingDown, Minus } from "lucide-react"
import { Bar, BarChart, XAxis, YAxis } from "recharts"

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { ExportButton } from "./export-button"
import { CategoryFilter } from "./category-filter"
import { useCategorySelection } from "./use-category-selection"

const TITLE = "Top 10 Branch Traffic Drivers"

export interface Driver {
  label: string
  value: number
}
export interface Trend {
  direction: "up" | "down" | "flat"
  pct: number
}

const chartConfig = {
  value: { label: "Tickets", color: "var(--chart-1)" },
} satisfies ChartConfig

function truncate(s: string, n = 22) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s
}

export function TopDriversChart({
  data,
  trend,
  subtitle,
}: {
  data: Driver[]
  trend: Trend
  subtitle: string
}) {
  const labels = data.map((d) => d.label)
  const { selected, setSelected } = useCategorySelection(labels)
  const shown = data.filter((d) => selected.has(d.label))
  const total = shown.reduce((sum, d) => sum + d.value, 0)
  const TrendIcon = trend.direction === "up" ? TrendingUp : trend.direction === "down" ? TrendingDown : Minus

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
        <div className="space-y-1">
          <CardTitle>{TITLE}</CardTitle>
          <CardDescription>Ticket volume by service</CardDescription>
        </div>
        <div className="flex items-center gap-0.5">
          <CategoryFilter labels={labels} selected={selected} onChange={setSelected} />
          <ExportButton
            title={TITLE}
            columns={[{ key: "label", header: "Service" }, { key: "value", header: "Tickets" }]}
            rows={shown}
          />
        </div>
      </CardHeader>
      <CardContent>
        {shown.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">No tickets match these filters.</p>
        ) : (
          <ChartContainer config={chartConfig} className="max-h-[280px] w-full">
            <BarChart accessibilityLayer data={shown} layout="vertical" margin={{ left: 8, right: 24 }}>
              <YAxis
                dataKey="label"
                type="category"
                tickLine={false}
                tickMargin={8}
                axisLine={false}
                width={150}
                tickFormatter={(v: string) => truncate(v)}
              />
              <XAxis dataKey="value" type="number" hide />
              <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
              <Bar dataKey="value" fill="var(--color-value)" radius={5} />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
      <CardFooter className="flex-col items-start gap-2 text-sm">
        <div className="flex gap-2 leading-none font-medium">
          {trend.direction === "flat"
            ? "Traffic is steady across the period"
            : `Trending ${trend.direction} by ${trend.pct}% over the period`}{" "}
          <TrendIcon className="h-4 w-4" />
        </div>
        <div className="leading-none text-muted-foreground">
          Showing {total.toLocaleString()} tickets · {subtitle}
        </div>
      </CardFooter>
    </Card>
  )
}
