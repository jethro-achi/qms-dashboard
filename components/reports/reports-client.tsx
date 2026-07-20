"use client"

import * as React from "react"
import { toast } from "sonner"
import { DownloadIcon, Loader2Icon, FileTextIcon } from "lucide-react"
import {
  Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { saveBlob } from "@/lib/save-file"

interface PeriodOption { value: string; label: string }
type PeriodType = "daily" | "monthly" | "quarterly" | "annual"
type ReportType = PeriodType | "custom"

const TYPE_ITEMS = [
  { value: "daily", label: "Daily" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "annual", label: "Annual" },
  { value: "custom", label: "Custom range" },
]
const FORMAT_ITEMS = [
  { value: "pdf", label: "PDF" },
  { value: "xlsx", label: "Excel (.xlsx)" },
  { value: "csv", label: "CSV" },
]
const ACCEPT: Record<string, Record<string, string[]>> = {
  pdf: { "application/pdf": [".pdf"] },
  xlsx: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"] },
  csv: { "text/csv": [".csv"] },
}

export function ReportsClient({
  periods,
  error,
  dataRange,
}: {
  periods: Record<PeriodType, PeriodOption[]>
  error: string | null
  dataRange?: { min: string; max: string } | null
}) {
  const [type, setType] = React.useState<ReportType>("monthly")
  const options = type === "custom" ? [] : (periods[type] ?? [])
  const [value, setValue] = React.useState<string>(options[0]?.value ?? "")
  const [format, setFormat] = React.useState<string>("pdf")
  const [busy, setBusy] = React.useState(false)
  // Custom range: default to the last 30 days of available data.
  const maxDay = dataRange?.max ?? new Date().toISOString().slice(0, 10)
  const defFrom = React.useMemo(() => {
    const d = new Date(`${maxDay}T00:00:00`)
    d.setDate(d.getDate() - 29)
    const floor = dataRange?.min
    const iso = d.toISOString().slice(0, 10)
    return floor && iso < floor ? floor : iso
  }, [maxDay, dataRange?.min])
  const [customFrom, setCustomFrom] = React.useState(defFrom)
  const [customTo, setCustomTo] = React.useState(maxDay)

  function onTypeChange(t: ReportType) {
    setType(t)
    if (t !== "custom") setValue(periods[t]?.[0]?.value ?? "")
  }

  // Resolve the value to send: a bucketed period value, or the custom range.
  const customValid = type === "custom" && !!customFrom && !!customTo && customFrom <= customTo
  const effectiveValue = type === "custom" ? `${customFrom}..${customTo}` : value
  const canDownload = type === "custom" ? customValid : !!value

  async function download() {
    if (!canDownload) {
      toast.error(type === "custom" ? "Pick a valid from/to date range." : "No period available to report on.")
      return
    }
    setBusy(true)
    try {
      const res = await fetch("/api/reports/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, value: effectiveValue, format }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(data?.error ?? "Could not generate the report.")
        return
      }
      const blob = await res.blob()
      const disp = res.headers.get("Content-Disposition") ?? ""
      const name = /filename="([^"]+)"/.exec(disp)?.[1] ?? `report.${format}`
      const result = await saveBlob(blob, name, ACCEPT[format])
      if (result === "saved") toast.success("Report downloaded.")
    } catch {
      toast.error("Could not generate the report.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Generate a report</CardTitle>
          <CardDescription>
            Download a scoped report for a period, as PDF, Excel, or CSV.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="grid gap-1.5">
            <label className="text-sm font-medium">Report type</label>
            <Select items={TYPE_ITEMS} value={type} onValueChange={(v) => onTypeChange((v as ReportType) ?? "monthly")}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TYPE_ITEMS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {type === "custom" ? (
            <div className="grid gap-1.5">
              <label className="text-sm font-medium">Date range</label>
              <div className="flex items-center gap-1.5">
                <input
                  type="date"
                  value={customFrom}
                  min={dataRange?.min}
                  max={customTo || dataRange?.max}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="w-full rounded-md border bg-transparent px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                />
                <span className="text-muted-foreground">–</span>
                <input
                  type="date"
                  value={customTo}
                  min={customFrom || dataRange?.min}
                  max={dataRange?.max}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="w-full rounded-md border bg-transparent px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                />
              </div>
              {!customValid && <p className="text-xs text-destructive">The “from” date must be on or before the “to” date.</p>}
            </div>
          ) : (
            <div className="grid gap-1.5">
              <label className="text-sm font-medium">Period</label>
              <Select items={options} value={value} onValueChange={(v) => setValue((v as string) ?? "")}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={options.length ? "Select a period" : "No data"} />
                </SelectTrigger>
                <SelectContent>
                  {options.length === 0 && <div className="px-2 py-1.5 text-sm text-muted-foreground">No periods with data</div>}
                  {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid gap-1.5">
            <label className="text-sm font-medium">Format</label>
            <Select items={FORMAT_ITEMS} value={format} onValueChange={(v) => setFormat((v as string) ?? "pdf")}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {FORMAT_ITEMS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {error && <p className="text-sm text-destructive sm:col-span-3">Could not load periods: {error}</p>}
        </CardContent>
        <CardFooter>
          <Button onClick={() => void download()} disabled={busy || !canDownload}>
            {busy ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <DownloadIcon className="h-4 w-4" />}
            Download report
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileTextIcon className="h-4 w-4" /> What's included
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <ul className="list-disc space-y-1 pl-5">
            <li>KPI summary: traffic, served, no-shows, wait & service times, SLA, NPS</li>
            <li>Performance by branch</li>
            <li>Traffic by service</li>
            <li>Staff performance</li>
            <li>Daily trend (monthly and longer)</li>
            <li>Hourly distribution</li>
          </ul>
          <p className="mt-3">All figures are limited to the branches you have access to.</p>
        </CardContent>
      </Card>
    </div>
  )
}
