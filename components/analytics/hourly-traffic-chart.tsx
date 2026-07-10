"use client"

import { TrendingUp, TrendingDown, Minus } from "lucide-react"
import { Bar, BarChart, CartesianGrid, LabelList, XAxis } from "recharts"

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
import type { Trend } from "./top-drivers-chart"
import { ExportButton } from "./export-button"
import { CategoryFilter } from "./category-filter"
import { useCategorySelection } from "./use-category-selection"

const TITLE = "Hourly Traffic Analysis"

export interface HourBucket {
  hour: number
  label: string
  value: number
}

const chartConfig = {
  value: { label: "Tickets", color: "var(--chart-1)" },
} satisfies ChartConfig

export function HourlyTrafficChart({
  data,
  trend,
  subtitle,
}: {
  data: HourBucket[]
  trend: Trend
  subtitle: string
}) {
  const labels = data.map((d) => d.label)
  const { selected, setSelected } = useCategorySelection(labels)
  const shown = data.filter((d) => selected.has(d.label))
  const total = shown.reduce((sum, d) => sum + d.value, 0)
  const peak = shown.reduce<HourBucket | null>((best, d) => (!best || d.value > best.value ? d : best), null)
  const TrendIcon = trend.direction === "up" ? TrendingUp : trend.direction === "down" ? TrendingDown : Minus

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
        <div className="space-y-1">
          <CardTitle>{TITLE}</CardTitle>
          <CardDescription>Tickets issued by hour of day</CardDescription>
        </div>
        <div className="flex items-center gap-0.5">
          <CategoryFilter labels={labels} selected={selected} onChange={setSelected} />
          <ExportButton
            title={TITLE}
            columns={[{ key: "label", header: "Hour" }, { key: "value", header: "Tickets" }]}
            rows={shown.map((d) => ({ label: d.label, value: d.value }))}
          />
        </div>
      </CardHeader>
      <CardContent>
        {shown.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">No tickets match these filters.</p>
        ) : (
          <ChartContainer config={chartConfig} className="max-h-[280px] w-full">
            <BarChart accessibilityLayer data={shown} margin={{ top: 24 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} tickMargin={10} axisLine={false} />
              <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
              <Bar dataKey="value" fill="var(--color-value)" radius={6} maxBarSize={48}>
                <LabelList position="top" offset={12} className="fill-foreground" fontSize={12} />
              </Bar>
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
      <CardFooter className="flex-col items-start gap-2 text-sm">
        <div className="flex gap-2 leading-none font-medium">
          {peak ? `Peak hour is ${peak.label} with ${peak.value} tickets` : "No traffic in range"}{" "}
          <TrendIcon className="h-4 w-4" />
        </div>
        <div className="leading-none text-muted-foreground">
          Showing {total.toLocaleString()} tickets · {subtitle}
        </div>
      </CardFooter>
    </Card>
  )
}
