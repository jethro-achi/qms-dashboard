"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { UploadIcon, Trash2Icon, WandSparklesIcon, PaletteIcon, GaugeIcon } from "lucide-react"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Slider } from "@/components/ui/slider"
import { Toggle } from "@/components/ui/toggle"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { extractLogoColors } from "@/lib/extract-colors"

export interface InitialTheme {
  mode: "light" | "dark"
  primary: string | null
  secondary: string | null
  accent: string | null
}

export interface InitialMetrics {
  slaSeconds: number
  anomalySeconds: number
}

const modeItems = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
]

const DEFAULT_SWATCH = "#2563eb"
const LOGO_BASE_PX = 48 // matches the sidebar's base logo height

function ColorField({
  label,
  value,
  onChange,
  suggested,
}: {
  label: string
  value: string // "" = default
  onChange: (v: string) => void
  suggested?: boolean
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value || DEFAULT_SWATCH}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-12 cursor-pointer rounded-none border bg-transparent p-1"
          aria-label={label}
        />
        <span className="text-sm text-muted-foreground">{value || "default"}</span>
        {value && (
          <Button variant="ghost" size="sm" onClick={() => onChange("")}>
            Reset
          </Button>
        )}
      </div>
      {suggested && value && (
        <span className="text-[11px] text-primary">Suggested from logo — adjust if needed.</span>
      )}
    </div>
  )
}

type Section = "appearance" | "metrics"

export function ThemeSettings({
  initialTheme,
  initialMetrics,
  initialHasLogo,
  initialLogoScale,
  initialShowTodayDefault,
}: {
  initialTheme: InitialTheme
  initialMetrics: InitialMetrics
  initialHasLogo: boolean
  initialLogoScale: number
  initialShowTodayDefault: boolean
}) {
  const router = useRouter()
  const [mode, setMode] = React.useState(initialTheme.mode)
  const [primary, setPrimary] = React.useState(initialTheme.primary ?? "")
  const [secondary, setSecondary] = React.useState(initialTheme.secondary ?? "")
  const [accent, setAccent] = React.useState(initialTheme.accent ?? "")
  const [suggested, setSuggested] = React.useState(false)
  const [slaMinutes, setSlaMinutes] = React.useState(String(Math.round(initialMetrics.slaSeconds / 60)))
  const [exceptionMinutes, setExceptionMinutes] = React.useState(String(Math.round(initialMetrics.anomalySeconds / 60)))
  const [showTodayDefault, setShowTodayDefault] = React.useState(initialShowTodayDefault)

  const [hasLogo, setHasLogo] = React.useState(initialHasLogo)
  const [logoData, setLogoData] = React.useState<string | null>(null) // pending upload
  const [removeLogo, setRemoveLogo] = React.useState(false)
  const [logoScale, setLogoScale] = React.useState(initialLogoScale)
  const [extracting, setExtracting] = React.useState(false)
  // Which card is currently saving. Kept per-section so clicking one Save button
  // never makes the other one show "Saving…".
  const [saving, setSaving] = React.useState<Section | null>(null)
  const fileRef = React.useRef<HTMLInputElement>(null)

  async function suggestFromSource(src: string) {
    setExtracting(true)
    try {
      const palette = await extractLogoColors(src)
      if (palette) {
        setPrimary(palette.primary)
        setSecondary(palette.secondary)
        setAccent(palette.accent)
        setSuggested(true)
        toast.success("Colours suggested from your logo. Tweak them, then Save appearance.")
      } else {
        toast.error("Couldn't read colours from that image.")
      }
    } finally {
      setExtracting(false)
    }
  }

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 1_000_000) {
      toast.error("Logo is too large (max 1 MB).")
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = String(reader.result)
      setLogoData(dataUrl)
      setRemoveLogo(false)
      // Auto-extract a suggested palette the moment a logo is chosen.
      void suggestFromSource(dataUrl)
    }
    reader.readAsDataURL(file)
  }

  async function post(section: Section, body: Record<string, unknown>) {
    setSaving(section)
    try {
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data?.error ?? "Could not save settings.")
        return false
      }
      router.refresh()
      return true
    } catch {
      toast.error("Could not save settings.")
      return false
    } finally {
      setSaving(null)
    }
  }

  async function saveAppearance() {
    const body: Record<string, unknown> = { mode, primary, secondary, accent, logoScale }
    if (logoData) body.logo = logoData
    else if (removeLogo) body.logo = ""
    const ok = await post("appearance", body)
    if (ok) {
      setHasLogo(logoData ? true : removeLogo ? false : hasLogo)
      setLogoData(null)
      setRemoveLogo(false)
      setSuggested(false)
      toast.success("Appearance updated.")
    }
  }

  async function saveMetrics() {
    const ok = await post("metrics", {
      slaMinutes: Number(slaMinutes) || undefined,
      exceptionMinutes: Number(exceptionMinutes) || undefined,
      showTodayDefault,
    })
    if (ok) toast.success("Thresholds updated.")
  }

  const showLogo = (hasLogo && !removeLogo) || Boolean(logoData)
  const logoSrc = logoData ?? `/api/branding/logo?v=${Date.now()}`
  const previewPx = Math.round((LOGO_BASE_PX * logoScale) / 100)

  return (
    <div className="grid gap-4 px-4 lg:grid-cols-3 lg:px-6">
      {/* Appearance: mode, brand colours, and the logo (upload + size). One
          clearly-scoped Save button for the whole card. */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <div className="flex items-center gap-2">
            <PaletteIcon className="size-4 text-primary" />
            <CardTitle>Appearance</CardTitle>
          </div>
          <CardDescription>App-wide theme and branding. Applies to every user of the dashboard.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6">
          <div className="grid max-w-xs gap-1.5">
            <label htmlFor="mode" className="text-sm font-medium">Default mode</label>
            <Select items={modeItems} value={mode} onValueChange={(v) => setMode((v as "light" | "dark") ?? "light")}>
              <SelectTrigger id="mode" className="w-48">
                <SelectValue>
                  {(value) => modeItems.find((m) => m.value === value)?.label ?? "Dark"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {modeItems.map((m) => (
                  <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">
              The starting theme for everyone. Each user can still flip light/dark from the header.
            </span>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <ColorField label="Primary" value={primary} onChange={(v) => { setPrimary(v); setSuggested(false) }} suggested={suggested} />
            <ColorField label="Secondary" value={secondary} onChange={(v) => { setSecondary(v); setSuggested(false) }} suggested={suggested} />
            <ColorField label="Accent" value={accent} onChange={(v) => { setAccent(v); setSuggested(false) }} suggested={suggested} />
          </div>
          <p className="text-xs text-muted-foreground">
            Leave a colour on “default” to use the built-in corporate palette.
          </p>

          {/* Logo */}
          <div className="grid gap-4 border-t pt-5">
            <div>
              <p className="text-sm font-medium">Client logo</p>
              <p className="text-xs text-muted-foreground">
                Shown top-left of the dashboard. Use a transparent PNG or SVG (no background).
              </p>
            </div>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              <div className="flex h-36 w-full max-w-xs items-center justify-center rounded-none border bg-[repeating-conic-gradient(theme(colors.muted.DEFAULT)_0%_25%,transparent_0%_50%)] bg-[length:16px_16px] p-3">
                {showLogo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logoSrc} alt="Client logo" style={{ height: previewPx }} className="w-auto max-w-[80%] object-contain" />
                ) : (
                  <span className="text-sm text-muted-foreground">No logo uploaded</span>
                )}
              </div>

              <div className="flex flex-1 flex-col gap-3">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/svg+xml,image/jpeg,image/webp,image/gif"
                  className="hidden"
                  onChange={onPickFile}
                />
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                    <UploadIcon className="h-4 w-4" />
                    Choose image
                  </Button>
                  {showLogo && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={extracting}
                      onClick={() => void suggestFromSource(logoSrc)}
                    >
                      <WandSparklesIcon className="h-4 w-4" />
                      {extracting ? "Reading…" : "Suggest colours"}
                    </Button>
                  )}
                  {(hasLogo || logoData) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-rose-600 dark:text-rose-400"
                      onClick={() => {
                        setLogoData(null)
                        setRemoveLogo(true)
                        if (fileRef.current) fileRef.current.value = ""
                      }}
                    >
                      <Trash2Icon className="h-4 w-4" />
                      Remove
                    </Button>
                  )}
                </div>

                {/* Logo size */}
                <div className="grid gap-1.5">
                  <div className="flex items-center justify-between">
                    <label htmlFor="logo-scale" className="text-sm font-medium">Logo size</label>
                    <span className="text-xs tabular-nums text-muted-foreground">{logoScale}%</span>
                  </div>
                  <Slider
                    id="logo-scale"
                    value={[logoScale]}
                    min={50}
                    max={200}
                    step={5}
                    className="max-w-xs"
                    onValueChange={(v) => setLogoScale(Array.isArray(v) ? v[0] : v)}
                  />
                  <span className="text-xs text-muted-foreground">Adjust how large the logo appears in the sidebar.</span>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
        <CardFooter>
          <Button onClick={() => void saveAppearance()} disabled={saving !== null}>
            {saving === "appearance" ? "Saving…" : "Save appearance"}
          </Button>
        </CardFooter>
      </Card>

      <Card className="lg:col-span-1">
        <CardHeader>
          <div className="flex items-center gap-2">
            <GaugeIcon className="size-4 text-primary" />
            <CardTitle>Metrics &amp; Thresholds</CardTitle>
          </div>
          <CardDescription>
            The dashboards recalculate automatically when you change these.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-1.5">
            <label htmlFor="sla" className="text-sm font-medium">SLA target (minutes)</label>
            <Input
              id="sla"
              type="number"
              min={1}
              max={600}
              value={slaMinutes}
              onChange={(e) => setSlaMinutes(e.target.value.replace(/\D/g, ""))}
            />
            <span className="text-xs text-muted-foreground">A ticket meets SLA if the wait is within this.</span>
          </div>
          <div className="grid gap-1.5">
            <label htmlFor="exc" className="text-sm font-medium">Exception threshold (minutes)</label>
            <Input
              id="exc"
              type="number"
              min={1}
              max={1440}
              value={exceptionMinutes}
              onChange={(e) => setExceptionMinutes(e.target.value.replace(/\D/g, ""))}
            />
            <span className="text-xs text-muted-foreground">Service times above this appear on the Exceptions report.</span>
          </div>
          <div className="grid gap-1.5 border-t pt-4">
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="today-default" className="text-sm font-medium">Default to today&apos;s data</label>
              <Toggle
                id="today-default"
                variant="outline"
                pressed={showTodayDefault}
                onPressedChange={setShowTodayDefault}
                aria-label="Default to today's data"
              >
                {showTodayDefault ? "On" : "Off"}
              </Toggle>
            </div>
            <span className="text-xs text-muted-foreground">
              When on, dashboards open scoped to today&apos;s tickets. Each user can turn the
              “Show today’s data” toggle off to browse history.
            </span>
          </div>
        </CardContent>
        <CardFooter>
          <Button onClick={() => void saveMetrics()} disabled={saving !== null}>
            {saving === "metrics" ? "Saving…" : "Save thresholds"}
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}
