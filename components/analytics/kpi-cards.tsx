// components/analytics/kpi-cards.tsx
// Home KPIs in the dashboard-01 "section cards" style: label, big number, a
// trend badge (green when moving the desirable way, red otherwise), a directional
// footer line, and two comparison deltas — vs last month and vs yesterday.
import { TrendingUpIcon, TrendingDownIcon, MinusIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ExportButton } from "./export-button"
import { cn } from "@/lib/utils"
import type { HomeKpi } from "@/lib/analytics/home"

type Direction = "up" | "down" | "flat"

function toneClass(direction: Direction, good: boolean) {
  return direction === "flat"
    ? "text-muted-foreground"
    : good
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-rose-600 dark:text-rose-400"
}

function DirectionIcon({ direction, className }: { direction: Direction; className?: string }) {
  const Icon = direction === "up" ? TrendingUpIcon : direction === "down" ? TrendingDownIcon : MinusIcon
  return <Icon className={className} />
}

// Primary (month-over-month) badge, top-right of the card.
function TrendBadge({ kpi }: { kpi: HomeKpi }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1",
        kpi.direction === "flat"
          ? "text-muted-foreground"
          : kpi.good
            ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
            : "border-rose-500/40 text-rose-600 dark:text-rose-400",
      )}
    >
      <DirectionIcon direction={kpi.direction} className="size-3.5" />
      {kpi.deltaLabel}
    </Badge>
  )
}

// A small labelled delta, e.g. "▲ 8% vs last month".
function MiniDelta({ deltaLabel, direction, good, label }: { deltaLabel: string; direction: Direction; good: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <DirectionIcon direction={direction} className={cn("size-3.5", toneClass(direction, good))} />
      <span className={cn("font-medium tabular-nums", toneClass(direction, good))}>{deltaLabel}</span>
      <span className="text-muted-foreground">{label}</span>
    </span>
  )
}

export function KpiCards({ kpis }: { kpis: HomeKpi[] }) {
  const exportRows = kpis.map((k) => ({
    metric: k.label,
    value: k.value,
    month: k.deltaLabel,
    day: k.dayDeltaLabel,
  }))
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-medium uppercase tracking-wide text-muted-foreground">
          <span aria-hidden className="h-3.5 w-1 rounded-full bg-primary" />
          Summary
        </h2>
        <ExportButton
          title="Key Metrics Summary"
          columns={[
            { key: "metric", header: "Metric" },
            { key: "value", header: "Value" },
            { key: "month", header: "Vs last month" },
            { key: "day", header: "Vs yesterday" },
          ]}
          rows={exportRows}
          label="Export"
        />
      </div>
      <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-2 @5xl/main:grid-cols-3">
        {kpis.map((kpi) => (
          <Card
            key={kpi.key}
            className="@container/card border-t-2 border-t-primary/60 bg-gradient-to-t from-primary/5 to-card shadow-xs dark:bg-card"
          >
            <CardHeader>
              <CardDescription>{kpi.label}</CardDescription>
              <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
                {kpi.value}
              </CardTitle>
              <CardAction>
                <TrendBadge kpi={kpi} />
              </CardAction>
            </CardHeader>
            <CardFooter className="flex-col items-start gap-1.5 text-sm">
              <div
                className={cn(
                  "line-clamp-1 flex items-center gap-2",
                  kpi.hasBaseline ? "font-medium" : "font-normal text-muted-foreground",
                )}
              >
                {kpi.footerStrong}
                {kpi.hasBaseline && <DirectionIcon direction={kpi.direction} className="size-4" />}
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
                <MiniDelta deltaLabel={kpi.deltaLabel} direction={kpi.direction} good={kpi.good} label="vs last month" />
                <MiniDelta deltaLabel={kpi.dayDeltaLabel} direction={kpi.dayDirection} good={kpi.dayGood} label="vs yesterday" />
              </div>
            </CardFooter>
          </Card>
        ))}
      </div>
    </div>
  )
}
