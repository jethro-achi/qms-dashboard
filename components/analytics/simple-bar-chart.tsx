"use client"

import { Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from "recharts"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"

export interface BarDatum {
  label: string
  value: number
}

const config = {
  value: { label: "Value", color: "var(--chart-1)" },
} satisfies ChartConfig

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s
}

/**
 * Generic single-series bar chart used across the report pages.
 * - orientation "horizontal": categories on the Y axis (good for long labels)
 * - orientation "vertical": categories on the X axis with value labels on top
 */
export function SimpleBarChart({
  data,
  orientation = "vertical",
  height = 260,
  valueSuffix = "",
  labelWidth = 130,
}: {
  data: BarDatum[]
  orientation?: "horizontal" | "vertical"
  height?: number
  valueSuffix?: string
  labelWidth?: number
}) {
  if (data.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">No data for these filters.</p>
  }

  return (
    <ChartContainer config={config} className="w-full" style={{ height }}>
      {orientation === "horizontal" ? (
        <BarChart accessibilityLayer data={data} layout="vertical" margin={{ left: 8, right: 32 }}>
          <YAxis
            dataKey="label"
            type="category"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            width={labelWidth}
            tickFormatter={(v: string) => truncate(v, Math.floor(labelWidth / 6))}
          />
          <XAxis dataKey="value" type="number" hide />
          <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="dashed" />} />
          <Bar dataKey="value" fill="var(--color-value)" radius={5}>
            <LabelList dataKey="value" position="right" offset={8} className="fill-foreground" fontSize={12}
              formatter={(v: number) => `${v}${valueSuffix}`} />
          </Bar>
        </BarChart>
      ) : (
        <BarChart accessibilityLayer data={data} margin={{ top: 24 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={10}
            tickFormatter={(v: string) => truncate(v, 12)} />
          <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="dashed" />} />
          {/* Cap width so a chart with only one or two bars doesn't render huge slabs. */}
          <Bar dataKey="value" fill="var(--color-value)" radius={6} maxBarSize={48}>
            <LabelList position="top" offset={10} className="fill-foreground" fontSize={12}
              formatter={(v: number) => `${v}${valueSuffix}`} />
          </Bar>
        </BarChart>
      )}
    </ChartContainer>
  )
}
