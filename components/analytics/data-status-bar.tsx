"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import { useRouter } from "next/navigation"
import {
  RefreshCwIcon, CheckIcon, Loader2Icon, XIcon, DatabaseIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress"
import { cn } from "@/lib/utils"

interface Status {
  online: boolean
  lastUpdatedIso: string | null
  serverNowIso: string
}

const STEPS = [
  { label: "Connecting to the database", pct: 30 },
  { label: "Fetching the latest data", pct: 65 },
  { label: "Applying updates", pct: 92 },
]

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

function updatedLabel(iso: string | null): { short: string; full: string } {
  if (!iso) return { short: "—", full: "No data yet" }
  const d = new Date(iso)
  if (isNaN(d.getTime())) return { short: "—", full: "Unknown" }
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1)
  const isYesterday = d.toDateString() === yesterday.toDateString()
  const short = sameDay
    ? `Today, ${time}`
    : isYesterday
      ? `Yesterday, ${time}`
      : `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${time}`
  return { short, full: d.toLocaleString() }
}

export function DataStatusBar() {
  const router = useRouter()
  const [status, setStatus] = React.useState<Status | null>(null)
  const [mounted, setMounted] = React.useState(false)
  const [refreshing, setRefreshing] = React.useState(false)
  const [step, setStep] = React.useState(0) // 0 idle · 1-3 active step · 4 done
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => setMounted(true), [])

  const fetchStatus = React.useCallback(async () => {
    try {
      const res = await fetch("/api/data/status", { cache: "no-store" })
      if (res.ok) setStatus(await res.json())
      else setStatus((s) => (s ? { ...s, online: false } : { online: false, lastUpdatedIso: null, serverNowIso: new Date().toISOString() }))
    } catch {
      setStatus((s) => (s ? { ...s, online: false } : { online: false, lastUpdatedIso: null, serverNowIso: new Date().toISOString() }))
    }
  }, [])

  React.useEffect(() => {
    void fetchStatus()
    const t = setInterval(() => void fetchStatus(), 30000)
    const onFocus = () => void fetchStatus()
    window.addEventListener("focus", onFocus)
    return () => { clearInterval(t); window.removeEventListener("focus", onFocus) }
  }, [fetchStatus])

  async function refresh() {
    if (refreshing) return
    setRefreshing(true)
    setError(null)
    setStep(1)

    // 1 — connect / probe the database
    let probed: Status | null = null
    try {
      const res = await fetch("/api/data/status", { cache: "no-store" })
      if (res.ok) probed = await res.json()
    } catch { /* handled below */ }
    await delay(550)
    if (!probed || !probed.online) {
      setError("Couldn't reach the database. Please try again.")
      setStatus(probed ?? { online: false, lastUpdatedIso: null, serverNowIso: new Date().toISOString() })
      return
    }

    // 2 — re-fetch the page's server data
    setStep(2)
    router.refresh()
    await delay(900)

    // 3 — apply
    setStep(3)
    await delay(500)
    setStatus(probed)

    // 4 — done
    setStep(4)
    await delay(650)
    setRefreshing(false)
    setStep(0)
  }

  function closeOverlay() {
    setRefreshing(false)
    setStep(0)
    setError(null)
  }

  const known = status !== null // avoid a false "Offline" flash before first probe
  const online = status?.online ?? false
  const { short, full } = updatedLabel(status?.lastUpdatedIso ?? null)

  const pct = error ? (step > 0 ? STEPS[Math.min(step, STEPS.length) - 1].pct : 0) : step === 4 ? 100 : STEPS[Math.max(step, 1) - 1].pct
  const heading = error ? "Couldn't reach the database" : step === 4 ? "Up to date" : STEPS[Math.max(step, 1) - 1].label

  return (
    <>
      <div className="ml-auto flex items-center gap-2 sm:gap-3">
        {/* Live connectivity light */}
        <span
          className="flex items-center gap-1.5"
          title={!known ? "Checking database connection…" : online ? "Live — connected to the database" : "Offline — database unreachable"}
        >
          <span className="relative flex size-2.5">
            {known && online && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
            )}
            <span className={cn(
              "relative inline-flex size-2.5 rounded-full",
              !known ? "bg-muted-foreground/40 animate-pulse" : online ? "bg-emerald-500" : "bg-rose-500",
            )} />
          </span>
          <span className="hidden text-xs font-medium text-muted-foreground sm:inline">
            {!known ? "Checking…" : online ? "Live" : "Offline"}
          </span>
        </span>

        {/* Last-updated date & time */}
        {known && status?.lastUpdatedIso && (
          <span className="hidden text-xs text-muted-foreground md:inline" title={`Data last updated: ${full}`}>
            Updated <span className="font-medium text-foreground">{short}</span>
          </span>
        )}

        <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={refreshing}>
          <RefreshCwIcon className={cn(refreshing && "animate-spin")} />
          <span className="hidden sm:inline">Refresh now</span>
        </Button>
      </div>

      {/* Full-screen blur + progress while refreshing */}
      {mounted && refreshing && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm border bg-card p-6 shadow-xl">
            <div className="mb-4 flex items-center gap-2">
              <DatabaseIcon className="size-4 text-primary" />
              <span className="font-medium">{error ? "Refresh failed" : "Refreshing data"}</span>
            </div>

            <Progress value={pct} className="w-full">
              <ProgressLabel>{heading}</ProgressLabel>
              <ProgressValue />
            </Progress>

            <ol className="mt-4 space-y-2 text-sm">
              {STEPS.map((s, i) => {
                const idx = i + 1
                const done = step > idx || step === 4
                const active = step === idx && !error
                const failed = step === idx && !!error
                return (
                  <li key={s.label} className="flex items-center gap-2">
                    <span className={cn(
                      "flex size-4 items-center justify-center",
                      done ? "text-emerald-600 dark:text-emerald-400" : failed ? "text-destructive" : "text-muted-foreground",
                    )}>
                      {done ? <CheckIcon className="size-4" />
                        : active ? <Loader2Icon className="size-4 animate-spin" />
                        : failed ? <XIcon className="size-4" />
                        : <span className="size-1.5 rounded-full bg-current opacity-40" />}
                    </span>
                    <span className={cn(
                      done ? "text-foreground" : active ? "text-foreground" : "text-muted-foreground",
                    )}>{s.label}</span>
                  </li>
                )
              })}
            </ol>

            {error && (
              <div className="mt-4 flex items-center justify-between gap-3">
                <p className="text-sm text-destructive">{error}</p>
                <Button size="sm" variant="outline" onClick={closeOverlay}>Close</Button>
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
