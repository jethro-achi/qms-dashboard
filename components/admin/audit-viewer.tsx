"use client"

import * as React from "react"
import { toast } from "sonner"
import { DownloadIcon, ShieldCheckIcon, ShieldAlertIcon, Loader2Icon } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { saveBlob } from "@/lib/save-file"

interface AuditRecord {
  id: number
  ts: string
  userId: number | null
  actorName: string | null
  actorEmail: string | null
  action: string
  resource: string
  details: Record<string, unknown>
  ip: string | null
  userAgent: string | null
}
interface Integrity { ok: boolean; brokenAtId: number | null }

const ACTION_LABELS: Record<string, string> = {
  LOGIN_SUCCESS: "Signed in", LOGIN_FAILURE: "Failed sign-in", LOGOUT: "Signed out",
  METRICS_QUERY: "Queried metrics", DETAIL_QUERY: "Queried detail", EXPORT: "Exported data",
  STREAM_OPEN: "Opened live stream", ACCESS_DENIED: "Access denied",
  USER_CREATE: "Created user", USER_UPDATE: "Updated user", USER_DELETE: "Deleted user",
  PASSWORD_RESET: "Reset password", SETTINGS_CHANGE: "Changed settings", REPORT_SCHEDULE: "Report schedule",
}
const FILTERS = [
  { value: "all", label: "All actions" },
  { value: "USER_CREATE", label: "Created user" },
  { value: "USER_UPDATE", label: "Updated user" },
  { value: "USER_DELETE", label: "Deleted user" },
  { value: "PASSWORD_RESET", label: "Reset password" },
  { value: "SETTINGS_CHANGE", label: "Changed settings" },
  { value: "LOGIN_SUCCESS", label: "Signed in" },
  { value: "LOGIN_FAILURE", label: "Failed sign-in" },
  { value: "EXPORT", label: "Exported data" },
]
const DESTRUCTIVE = new Set(["USER_DELETE", "LOGIN_FAILURE", "ACCESS_DENIED"])

function fmtTs(ts: string) {
  const d = new Date(ts)
  return isNaN(d.getTime()) ? ts : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" })
}
function detailText(d: Record<string, unknown>): string {
  const parts: string[] = []
  for (const [k, v] of Object.entries(d)) {
    if (v === undefined || v === null || v === "") continue
    parts.push(`${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
  }
  return parts.join(" · ")
}

export function AuditViewer({
  initialEntries,
  initialTotal,
  integrity,
}: {
  initialEntries: AuditRecord[]
  initialTotal: number
  integrity: Integrity
}) {
  const [entries, setEntries] = React.useState(initialEntries)
  const [total, setTotal] = React.useState(initialTotal)
  const [action, setAction] = React.useState("all")
  const [loading, setLoading] = React.useState(false)

  const load = React.useCallback(async (act: string, offset: number) => {
    setLoading(true)
    try {
      const p = new URLSearchParams({ limit: "100", offset: String(offset) })
      if (act !== "all") p.set("action", act)
      const res = await fetch(`/api/admin/audit?${p}`, { cache: "no-store" })
      if (!res.ok) { toast.error("Could not load the audit log."); return }
      const data = await res.json()
      setTotal(Number(data.total ?? 0))
      setEntries((prev) => (offset === 0 ? data.entries : [...prev, ...data.entries]))
    } finally {
      setLoading(false)
    }
  }, [])

  function onFilter(v: string) {
    setAction(v)
    void load(v, 0)
  }

  async function download() {
    try {
      const res = await fetch("/api/admin/audit/download")
      if (!res.ok) { toast.error("Could not export the audit log."); return }
      const blob = await res.blob()
      const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "audit-log.csv"
      const r = await saveBlob(blob, name, { "text/csv": [".csv"] })
      if (r === "saved") toast.success("Audit log exported.")
    } catch { toast.error("Could not export the audit log.") }
  }

  return (
    <div className="grid gap-4 px-4 lg:px-6">
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-base">Audit trail</CardTitle>
            <CardDescription>Who did what, and when. Tamper-evident (hash-chained).</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {integrity.ok ? (
              <Badge variant="outline" className="gap-1 border-emerald-500/40 text-emerald-600 dark:text-emerald-400">
                <ShieldCheckIcon className="size-3.5" /> Chain intact
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1 border-rose-500/40 text-rose-600 dark:text-rose-400">
                <ShieldAlertIcon className="size-3.5" /> Broken at #{integrity.brokenAtId}
              </Badge>
            )}
            <Select items={FILTERS} value={action} onValueChange={(v) => onFilter((v as string) ?? "all")}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                {FILTERS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => void download()}>
              <DownloadIcon /> Export CSV
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-none border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap">When</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Details</TableHead>
                  <TableHead>IP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.length === 0 && (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No audit entries.</TableCell></TableRow>
                )}
                {entries.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{fmtTs(e.ts)}</TableCell>
                    <TableCell>
                      <div className="font-medium">{e.actorName ?? (e.userId ? `#${e.userId}` : "—")}</div>
                      {e.actorEmail && <div className="text-xs text-muted-foreground">{e.actorEmail}</div>}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={DESTRUCTIVE.has(e.action) ? "border-rose-500/40 text-rose-600 dark:text-rose-400" : ""}>
                        {ACTION_LABELS[e.action] ?? e.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-md truncate text-muted-foreground" title={detailText(e.details)}>
                      <span className="font-mono text-xs">{e.resource}</span>
                      {detailText(e.details) && <span className="ml-2">{detailText(e.details)}</span>}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{e.ip ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
            <span>Showing {entries.length} of {total}</span>
            {entries.length < total && (
              <Button variant="outline" size="sm" disabled={loading} onClick={() => void load(action, entries.length)}>
                {loading ? <Loader2Icon className="size-4 animate-spin" /> : null} Load more
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
