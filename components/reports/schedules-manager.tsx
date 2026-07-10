"use client"

import * as React from "react"
import { toast } from "sonner"
import {
  PlusIcon, Loader2Icon, Trash2Icon, DownloadIcon, PlayIcon, PauseIcon,
  CalendarClockIcon, InboxIcon,
} from "lucide-react"
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { saveBlob } from "@/lib/save-file"

type PeriodType = "daily" | "monthly" | "quarterly" | "annual"
type ReportFormat = "pdf" | "xlsx" | "csv"

export interface Schedule {
  id: number
  name: string
  reportType: PeriodType
  format: ReportFormat
  isActive: boolean
  nextRunAt: string
  lastRunAt: string | null
  createdAt: string
}
export interface GeneratedReport {
  id: number
  displayName: string
  format: ReportFormat
  periodLabel: string
  byteSize: number
  createdAt: string
  scheduleName: string | null
}

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
const CADENCE: Record<PeriodType, string> = {
  daily: "Every day", monthly: "Every month", quarterly: "Every quarter", annual: "Every year",
}
const ACCEPT: Record<string, Record<string, string[]>> = {
  pdf: { "application/pdf": [".pdf"] },
  xlsx: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"] },
  csv: { "text/csv": [".csv"] },
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  return isNaN(d.getTime()) ? "—" : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
}
function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export function SchedulesManager({
  initialSchedules,
  initialReports,
}: {
  initialSchedules: Schedule[]
  initialReports: GeneratedReport[]
}) {
  const [schedules, setSchedules] = React.useState<Schedule[]>(initialSchedules)
  const [reports, setReports] = React.useState<GeneratedReport[]>(initialReports)

  const [name, setName] = React.useState("")
  const [type, setType] = React.useState<PeriodType>("monthly")
  const [format, setFormat] = React.useState<ReportFormat>("pdf")
  const [creating, setCreating] = React.useState(false)
  const [busyId, setBusyId] = React.useState<number | null>(null)

  async function create() {
    const trimmed = name.trim()
    if (!trimmed) { toast.error("Give the schedule a name."); return }
    setCreating(true)
    try {
      const res = await fetch("/api/reports/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, reportType: type, format }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data?.error ?? "Could not create the schedule."); return }
      setSchedules(data.schedules ?? [])
      setName("")
      toast.success("Schedule created.")
    } catch { toast.error("Could not create the schedule.") }
    finally { setCreating(false) }
  }

  async function toggle(s: Schedule) {
    setBusyId(s.id)
    try {
      const res = await fetch(`/api/reports/schedules/${s.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !s.isActive }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data?.error ?? "Could not update the schedule."); return }
      setSchedules(data.schedules ?? [])
    } catch { toast.error("Could not update the schedule.") }
    finally { setBusyId(null) }
  }

  async function remove(s: Schedule) {
    setBusyId(s.id)
    try {
      const res = await fetch(`/api/reports/schedules/${s.id}`, { method: "DELETE" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data?.error ?? "Could not delete the schedule."); return }
      setSchedules(data.schedules ?? [])
      toast.success("Schedule removed.")
    } catch { toast.error("Could not delete the schedule.") }
    finally { setBusyId(null) }
  }

  async function refreshReports() {
    try {
      const res = await fetch("/api/reports/generated")
      const data = await res.json().catch(() => ({}))
      if (res.ok) setReports(data.reports ?? [])
    } catch { /* ignore */ }
  }

  async function downloadReport(r: GeneratedReport) {
    setBusyId(-r.id)
    try {
      const res = await fetch(`/api/reports/generated/${r.id}/download`)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(data?.error ?? "Could not download the report.")
        return
      }
      const blob = await res.blob()
      const result = await saveBlob(blob, r.displayName, ACCEPT[r.format])
      if (result === "saved") toast.success("Report downloaded.")
    } catch { toast.error("Could not download the report.") }
    finally { setBusyId(null) }
  }

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarClockIcon className="h-4 w-4" /> Scheduled reports
          </CardTitle>
          <CardDescription>
            Set a report to generate automatically each day, month, quarter, or year. Each run
            produces the period that just ended and files it under “Ready to download” below.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {/* create row */}
          <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
            <div className="grid gap-1.5">
              <label className="text-sm font-medium">Name</label>
              <Input
                placeholder="e.g. Monthly branch summary"
                value={name}
                maxLength={120}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <label className="text-sm font-medium">Frequency</label>
              <Select items={TYPE_ITEMS} value={type} onValueChange={(v) => setType((v as PeriodType) ?? "monthly")}>
                <SelectTrigger className="w-full sm:w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TYPE_ITEMS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <label className="text-sm font-medium">Format</label>
              <Select items={FORMAT_ITEMS} value={format} onValueChange={(v) => setFormat((v as ReportFormat) ?? "pdf")}>
                <SelectTrigger className="w-full sm:w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FORMAT_ITEMS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={() => void create()} disabled={creating}>
              {creating ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <PlusIcon className="h-4 w-4" />}
              Add
            </Button>
          </div>

          {/* schedules table */}
          {schedules.length === 0 ? (
            <p className="text-sm text-muted-foreground">No schedules yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Frequency</TableHead>
                    <TableHead>Format</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Next run</TableHead>
                    <TableHead>Last run</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {schedules.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell>{CADENCE[s.reportType]}</TableCell>
                      <TableCell className="uppercase">{s.format}</TableCell>
                      <TableCell>
                        <Badge variant={s.isActive ? "default" : "secondary"}>
                          {s.isActive ? "Active" : "Paused"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{s.isActive ? fmtDate(s.nextRunAt) : "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{fmtDate(s.lastRunAt)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost" size="sm" disabled={busyId === s.id}
                            onClick={() => void toggle(s)}
                            title={s.isActive ? "Pause" : "Resume"}
                          >
                            {s.isActive ? <PauseIcon className="h-4 w-4" /> : <PlayIcon className="h-4 w-4" />}
                          </Button>
                          <Button
                            variant="ghost" size="sm" disabled={busyId === s.id}
                            onClick={() => void remove(s)}
                            title="Delete"
                          >
                            <Trash2Icon className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <InboxIcon className="h-4 w-4" /> Ready to download
            </CardTitle>
            <CardDescription>Reports produced by your schedules.</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => void refreshReports()}>Refresh</Button>
        </CardHeader>
        <CardContent>
          {reports.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No reports yet. They’ll appear here after a schedule runs.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Report</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead>Format</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>Generated</TableHead>
                    <TableHead className="text-right">Download</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reports.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.scheduleName ?? "Report"}</TableCell>
                      <TableCell>{r.periodLabel}</TableCell>
                      <TableCell className="uppercase">{r.format}</TableCell>
                      <TableCell className="text-muted-foreground">{fmtSize(r.byteSize)}</TableCell>
                      <TableCell className="text-muted-foreground">{fmtDate(r.createdAt)}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost" size="sm" disabled={busyId === -r.id}
                          onClick={() => void downloadReport(r)}
                        >
                          {busyId === -r.id
                            ? <Loader2Icon className="h-4 w-4 animate-spin" />
                            : <DownloadIcon className="h-4 w-4" />}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
