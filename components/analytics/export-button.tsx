"use client"

import * as React from "react"
import { DownloadIcon, Loader2Icon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"

export interface ExportColumn {
  key: string
  header: string
}

type CellValue = string | number | boolean | null

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

interface SaveFilePickerWindow {
  showSaveFilePicker?: (opts: {
    suggestedName?: string
    types?: { description: string; accept: Record<string, string[]> }[]
  }) => Promise<{
    createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }>
  }>
}

function safeName(title: string): string {
  return (title.replace(/[^\w\-. ]/g, "_").trim().slice(0, 100) || "export") + ".xlsx"
}

async function saveBlob(blob: Blob, filename: string): Promise<"saved" | "cancelled"> {
  const w = window as unknown as SaveFilePickerWindow
  if (typeof w.showSaveFilePicker === "function") {
    // Native "choose location + name" dialog (Chromium browsers).
    try {
      const handle = await w.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: "Excel Workbook", accept: { [XLSX_MIME]: [".xlsx"] } }],
      })
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      return "saved"
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return "cancelled"
      throw err
    }
  }
  // Fallback: normal download (goes to the browser's download location; users
  // who enable "ask where to save" still get a prompt).
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
  return "saved"
}

export function ExportButton({
  title,
  columns,
  rows,
  label,
}: {
  title: string
  columns: ExportColumn[]
  // `object[]` so typed chart/table row arrays (interfaces without an index
  // signature) are accepted; the server zod-validates every cell is a
  // primitive before writing the workbook.
  rows: readonly object[]
  /** When set, shows a text button instead of an icon-only button. */
  label?: string
}) {
  const [busy, setBusy] = React.useState(false)

  async function onExport() {
    if (rows.length === 0) {
      toast.error("There is no data to export.")
      return
    }
    setBusy(true)
    try {
      const res = await fetch("/api/export/visual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, columns, rows }),
      })
      if (!res.ok) {
        toast.error("Export failed. Please try again.")
        return
      }
      const blob = await res.blob()
      const result = await saveBlob(blob, safeName(title))
      if (result === "saved") toast.success(`Exported “${title}”.`)
    } catch {
      toast.error("Export failed. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button
      variant="ghost"
      size={label ? "sm" : "icon"}
      onClick={onExport}
      disabled={busy}
      title={`Download “${title}” as Excel`}
      aria-label={`Download ${title} as Excel`}
    >
      {busy ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <DownloadIcon className="h-4 w-4" />}
      {label}
    </Button>
  )
}
