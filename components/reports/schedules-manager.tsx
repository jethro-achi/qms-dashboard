"use client"

import * as React from "react"
import { toast } from "sonner"
import {
  PlusIcon, Loader2Icon, Trash2Icon, DownloadIcon, PlayIcon, PauseIcon,
  CalendarClockIcon, InboxIcon, UsersIcon, Share2Icon,
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
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { saveBlob } from "@/lib/save-file"

type PeriodType = "daily" | "monthly" | "quarterly" | "annual"
type ReportFormat = "pdf" | "xlsx" | "csv"

export interface Recipient {
  id: number
  name: string
  email?: string
}
export interface Schedule {
  id: number
  name: string
  reportType: PeriodType
  format: ReportFormat
  isActive: boolean
  runHour: number
  runMinute: number
  dayOfMonth: number
  monthOfYear: number
  recipients: Recipient[]
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
  shared: boolean
  ownerName: string | null
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
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]
const ACCEPT: Record<string, Record<string, string[]>> = {
  pdf: { "application/pdf": [".pdf"] },
  xlsx: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"] },
  csv: { "text/csv": [".csv"] },
}

const pad = (n: number) => String(n).padStart(2, "0")
// Time is stored internally as a 24-hour runHour (0–23); the UI picks a 1–12
// hour plus an AM/PM meridiem and maps between the two.
const HOURS_12 = Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))
const AMPM_ITEMS = [{ value: "AM", label: "AM" }, { value: "PM", label: "PM" }]
const MINUTES = [0, 15, 30, 45].map((m) => ({ value: String(m), label: pad(m) }))
const DAYS = Array.from({ length: 28 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))
const MONTH_ITEMS = MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))

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
/** 24-hour hour + minute -> a 12-hour clock label, e.g. "6:00 AM". */
function to12h(hour24: number, minute: number): string {
  const h = hour24 % 12 === 0 ? 12 : hour24 % 12
  const ampm = hour24 < 12 ? "AM" : "PM"
  return `${h}:${pad(minute)} ${ampm}`
}
function describeTiming(s: Schedule): string {
  const t = to12h(s.runHour, s.runMinute)
  if (s.reportType === "daily") return `at ${t}`
  if (s.reportType === "monthly") return `day ${s.dayOfMonth}, ${t}`
  if (s.reportType === "quarterly") return `quarter start, day ${s.dayOfMonth}, ${t}`
  return `${MONTHS[s.monthOfYear - 1]} ${s.dayOfMonth}, ${t}`
}

/** Multi-select of admin recipients, rendered as a dropdown of checkboxes. */
function RecipientPicker({
  recipients, selected, onToggle, label,
}: {
  recipients: Recipient[]
  selected: Set<number>
  onToggle: (id: number) => void
  label: string
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" className="w-full justify-start sm:w-52" />}
      >
        <UsersIcon className="h-4 w-4" />
        <span className="truncate">{label}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 w-64 overflow-auto">
        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Share with (admins)</div>
        <DropdownMenuSeparator />
        {recipients.length === 0 ? (
          <div className="px-2 py-2 text-xs text-muted-foreground">No admins available to share with.</div>
        ) : (
          recipients.map((r) => (
            <DropdownMenuCheckboxItem
              key={r.id}
              checked={selected.has(r.id)}
              onCheckedChange={() => onToggle(r.id)}
              closeOnClick={false}
            >
              <span className="truncate">{r.name}</span>
            </DropdownMenuCheckboxItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Per-report share control (owner only). */
function ShareMenu({ reportId, recipients }: { reportId: number; recipients: Recipient[] }) {
  const [sel, setSel] = React.useState<Set<number>>(new Set())
  const [busy, setBusy] = React.useState(false)

  function toggle(id: number) {
    setSel((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function share() {
    if (sel.size === 0) { toast.error("Pick at least one admin."); return }
    setBusy(true)
    try {
      const res = await fetch(`/api/reports/generated/${reportId}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientIds: [...sel] }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data?.error ?? "Could not share the report."); return }
      toast.success(`Shared with ${data.added ?? sel.size} recipient(s).`)
      setSel(new Set())
    } catch { toast.error("Could not share the report.") }
    finally { setBusy(false) }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="sm" title="Share with admins" />}>
        {busy ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <Share2Icon className="h-4 w-4" />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-72 w-64 overflow-auto">
        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Share with (admins)</div>
        <DropdownMenuSeparator />
        {recipients.length === 0 ? (
          <div className="px-2 py-2 text-xs text-muted-foreground">No admins available to share with.</div>
        ) : (
          <>
            {recipients.map((r) => (
              <DropdownMenuCheckboxItem
                key={r.id}
                checked={sel.has(r.id)}
                onCheckedChange={() => toggle(r.id)}
                closeOnClick={false}
              >
                <span className="truncate">{r.name}</span>
              </DropdownMenuCheckboxItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="justify-center font-medium" onClick={() => void share()} closeOnClick={false}>
              {busy ? "Sharing…" : "Share"}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
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
  const [recipients, setRecipients] = React.useState<Recipient[]>([])

  const [name, setName] = React.useState("")
  const [type, setType] = React.useState<PeriodType>("monthly")
  const [format, setFormat] = React.useState<ReportFormat>("pdf")
  const [runHour, setRunHour] = React.useState(6)
  const [runMinute, setRunMinute] = React.useState(0)
  const [dayOfMonth, setDayOfMonth] = React.useState(1)
  const [monthOfYear, setMonthOfYear] = React.useState(1)
  const [selectedRecipients, setSelectedRecipients] = React.useState<Set<number>>(new Set())
  const [creating, setCreating] = React.useState(false)
  const [busyId, setBusyId] = React.useState<number | null>(null)

  React.useEffect(() => {
    fetch("/api/reports/recipients")
      .then((r) => r.json())
      .then((d) => setRecipients(d.recipients ?? []))
      .catch(() => { /* leaves the picker empty */ })
  }, [])

  function toggleRecipient(id: number) {
    setSelectedRecipients((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function create() {
    const trimmed = name.trim()
    if (!trimmed) { toast.error("Give the schedule a name."); return }
    setCreating(true)
    try {
      const res = await fetch("/api/reports/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmed,
          reportType: type,
          format,
          timing: { runHour, runMinute, dayOfMonth, monthOfYear },
          recipientIds: [...selectedRecipients],
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data?.error ?? "Could not create the schedule."); return }
      setSchedules(data.schedules ?? [])
      setName("")
      setSelectedRecipients(new Set())
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

  const recipientLabel =
    selectedRecipients.size === 0 ? "Recipients" : `${selectedRecipients.size} recipient(s)`

  // 12-hour view over the 24-hour runHour state.
  const hour12 = runHour % 12 === 0 ? 12 : runHour % 12
  const meridiem: "AM" | "PM" = runHour < 12 ? "AM" : "PM"
  function setHour12(h: number) {
    const base = h % 12 // 12 -> 0
    setRunHour(meridiem === "PM" ? base + 12 : base)
  }
  function setMeridiem(m: "AM" | "PM") {
    const base = runHour % 12
    setRunHour(m === "PM" ? base + 12 : base)
  }
  // Plain-English preview of the schedule being built, shown under the form.
  function describeForm(): string {
    const t = to12h(runHour, runMinute)
    if (type === "daily") return `Runs every day at ${t}.`
    if (type === "monthly") return `Runs on day ${dayOfMonth} of every month at ${t}.`
    if (type === "quarterly")
      return `Runs on day ${dayOfMonth} of each quarter start (Jan, Apr, Jul, Oct) at ${t}.`
    return `Runs every year on ${MONTHS[monthOfYear - 1]} ${dayOfMonth} at ${t}.`
  }

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarClockIcon className="h-4 w-4" /> Scheduled reports
          </CardTitle>
          <CardDescription>
            Choose a frequency and the exact day/time it should run. Each run produces the period that
            just ended, files it under “Ready to download”, and delivers it to any recipients you pick.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {/* create form */}
          <div className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TYPE_ITEMS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <label className="text-sm font-medium">Format</label>
                <Select items={FORMAT_ITEMS} value={format} onValueChange={(v) => setFormat((v as ReportFormat) ?? "pdf")}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FORMAT_ITEMS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <label className="text-sm font-medium">Recipients</label>
                <RecipientPicker
                  recipients={recipients}
                  selected={selectedRecipients}
                  onToggle={toggleRecipient}
                  label={recipientLabel}
                />
              </div>
            </div>

            {/* timing row — fields depend on the frequency */}
            <div className="flex flex-wrap items-end gap-3">
              {type === "annual" && (
                <div className="grid gap-1.5">
                  <label className="text-sm font-medium">Month</label>
                  <Select items={MONTH_ITEMS} value={String(monthOfYear)} onValueChange={(v) => setMonthOfYear(Number(v) || 1)}>
                    <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {MONTH_ITEMS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {(type === "monthly" || type === "quarterly" || type === "annual") && (
                <div className="grid gap-1.5">
                  <label className="text-sm font-medium">Day{type === "quarterly" ? " (of quarter start)" : ""}</label>
                  <Select items={DAYS} value={String(dayOfMonth)} onValueChange={(v) => setDayOfMonth(Number(v) || 1)}>
                    <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                    <SelectContent className="max-h-64">
                      {DAYS.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="grid gap-1.5">
                <label className="text-sm font-medium">Time</label>
                <div className="flex items-center gap-1">
                  <Select items={HOURS_12} value={String(hour12)} onValueChange={(v) => setHour12(Number(v) || 12)}>
                    <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
                    <SelectContent className="max-h-64">
                      {HOURS_12.map((h) => <SelectItem key={h.value} value={h.value}>{h.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <span className="text-muted-foreground">:</span>
                  <Select items={MINUTES} value={String(runMinute)} onValueChange={(v) => setRunMinute(Number(v) || 0)}>
                    <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {MINUTES.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select items={AMPM_ITEMS} value={meridiem} onValueChange={(v) => setMeridiem((v as "AM" | "PM") || "AM")}>
                    <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {AMPM_ITEMS.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button onClick={() => void create()} disabled={creating} className="ml-auto">
                {creating ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <PlusIcon className="h-4 w-4" />}
                Add schedule
              </Button>
            </div>

            {/* Live plain-English preview of the schedule being configured. */}
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Preview: </span>
              {describeForm()}
            </p>
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
                    <TableHead>When</TableHead>
                    <TableHead>Format</TableHead>
                    <TableHead>Recipients</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Next run</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {schedules.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell>{CADENCE[s.reportType]}</TableCell>
                      <TableCell className="text-muted-foreground">{describeTiming(s)}</TableCell>
                      <TableCell className="uppercase">{s.format}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {s.recipients.length === 0
                          ? "—"
                          : s.recipients.length <= 2
                            ? s.recipients.map((r) => r.name).join(", ")
                            : `${s.recipients.length} admins`}
                      </TableCell>
                      <TableCell>
                        <Badge variant={s.isActive ? "default" : "secondary"}>
                          {s.isActive ? "Active" : "Paused"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{s.isActive ? fmtDate(s.nextRunAt) : "—"}</TableCell>
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
            <CardDescription>Reports produced by your schedules, plus any shared with you.</CardDescription>
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
                    <TableHead>From</TableHead>
                    <TableHead>Format</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>Generated</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reports.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.scheduleName ?? "Report"}</TableCell>
                      <TableCell>{r.periodLabel}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {r.shared ? (r.ownerName ?? "Shared") : "You"}
                        {r.shared && <Badge variant="secondary" className="ml-2">Shared</Badge>}
                      </TableCell>
                      <TableCell className="uppercase">{r.format}</TableCell>
                      <TableCell className="text-muted-foreground">{fmtSize(r.byteSize)}</TableCell>
                      <TableCell className="text-muted-foreground">{fmtDate(r.createdAt)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {!r.shared && <ShareMenu reportId={r.id} recipients={recipients} />}
                          <Button
                            variant="ghost" size="sm" disabled={busyId === -r.id}
                            onClick={() => void downloadReport(r)}
                            title="Download"
                          >
                            {busyId === -r.id
                              ? <Loader2Icon className="h-4 w-4 animate-spin" />
                              : <DownloadIcon className="h-4 w-4" />}
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
    </div>
  )
}
