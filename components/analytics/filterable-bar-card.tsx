"use client"

import * as React from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { SimpleBarChart, type BarDatum } from "./simple-bar-chart"
import { CategoryFilter } from "./category-filter"
import { ExportButton, type ExportColumn } from "./export-button"

/**
 * A bar-chart card with a per-visual category filter and an Excel export.
 * The filter slices the loaded data client-side; the chart AND the export both
 * reflect the current selection. When the underlying data changes (e.g. a
 * global filter is applied) the selection resets to "all".
 */
export function FilterableBarCard({
  title,
  data,
  orientation = "vertical",
  valueSuffix = "",
  labelWidth,
  exportColumns,
}: {
  title: string
  data: BarDatum[]
  orientation?: "horizontal" | "vertical"
  valueSuffix?: string
  labelWidth?: number
  exportColumns: ExportColumn[]
}) {
  const labels = data.map((d) => d.label)
  const dataKey = labels.join("|")

  // Keyed by dataKey so a new dataset (after a global filter change) resets to
  // "all" without an effect.
  const [state, setState] = React.useState<{ key: string; selected: Set<string> }>({
    key: dataKey,
    selected: new Set(labels),
  })
  const selected = state.key === dataKey ? state.selected : new Set(labels)
  const setSelected = (next: Set<string>) => setState({ key: dataKey, selected: next })

  const shown = data.filter((d) => selected.has(d.label))

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-base font-medium">{title}</CardTitle>
        <div className="flex items-center gap-0.5">
          <CategoryFilter labels={labels} selected={selected} onChange={setSelected} />
          <ExportButton title={title} columns={exportColumns} rows={shown} />
        </div>
      </CardHeader>
      <CardContent>
        <SimpleBarChart
          data={shown}
          orientation={orientation}
          valueSuffix={valueSuffix}
          labelWidth={labelWidth}
        />
      </CardContent>
    </Card>
  )
}
