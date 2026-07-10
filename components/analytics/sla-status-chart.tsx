"use client"

import * as React from "react"
import { Bar, BarChart, XAxis, YAxis } from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { CategoryFilter } from "./category-filter"
import { ExportButton } from "./export-button"

export interface SlaDatum {
  staff: string
  within: number
  outside: number
}

const config = {
  within: { label: "Within SLA", color: "var(--chart-1)" },
  outside: { label: "Outside SLA", color: "var(--chart-4)" },
} satisfies ChartConfig

const TITLE = "SLA Status for Tickets served by Staff"

export function SlaStatusChart({ data }: { data: SlaDatum[] }) {
  const labels = data.map((d) => d.staff)
  const dataKey = labels.join("|")
  const [state, setState] = React.useState<{ key: string; selected: Set<string> }>({
    key: dataKey,
    selected: new Set(labels),
  })
  const selected = state.key === dataKey ? state.selected : new Set(labels)
  const setSelected = (next: Set<string>) => setState({ key: dataKey, selected: next })
  const shown = data.filter((d) => selected.has(d.staff))

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-base font-medium">{TITLE}</CardTitle>
        <div className="flex items-center gap-0.5">
          <CategoryFilter labels={labels} selected={selected} onChange={setSelected} />
          <ExportButton
            title={TITLE}
            columns={[
              { key: "staff", header: "Staff" },
              { key: "within", header: "Within SLA" },
              { key: "outside", header: "Outside SLA" },
            ]}
            rows={shown}
          />
        </div>
      </CardHeader>
      <CardContent>
        {shown.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">No served tickets for these filters.</p>
        ) : (
          <ChartContainer config={config} className="h-[260px] w-full">
            <BarChart accessibilityLayer data={shown} layout="vertical" margin={{ left: 8, right: 16 }}>
              <YAxis dataKey="staff" type="category" tickLine={false} axisLine={false} width={90} />
              <XAxis type="number" hide />
              <ChartTooltip content={<ChartTooltipContent />} />
              <ChartLegend content={<ChartLegendContent />} />
              <Bar dataKey="within" stackId="a" fill="var(--color-within)" radius={[4, 0, 0, 4]} />
              <Bar dataKey="outside" stackId="a" fill="var(--color-outside)" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}
