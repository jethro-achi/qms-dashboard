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

const TYPE_ITEMS = [
  { value: "daily", label: "Daily" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "annual", label: "Annual" },
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
}: {
  periods: Record<PeriodType, PeriodOption[]>
  error: string | null
}) {
  const [type, setType] = React.useState<PeriodType>("monthly")
  const options = periods[type] ?? []
  const [value, setValue] = React.useState<string>(options[0]?.value ?? "")
  const [format, setFormat] = React.useState<string>("pdf")
  const [busy, setBusy] = React.useState(false)

  function onTypeChange(t: PeriodType) {
    setType(t)
    setValue(periods[t]?.[0]?.value ?? "")
  }

  async function download() {
    if (!value) {
      toast.error("No period available to report on.")
      return
    }
    setBusy(true)
    try {
      const res = await fetch("/api/reports/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, value, format }),
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
            <Select items={TYPE_ITEMS} value={type} onValueChange={(v) => onTypeChange((v as PeriodType) ?? "monthly")}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TYPE_ITEMS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
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
          <Button onClick={() => void download()} disabled={busy || !value}>
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
            <li>KPI summary — traffic, served, no-shows, wait & service times, SLA, NPS</li>
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
