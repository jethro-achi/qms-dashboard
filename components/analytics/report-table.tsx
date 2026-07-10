"use client"

import * as React from "react"
import { Search } from "lucide-react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { ExportButton } from "./export-button"

export interface Column<T> {
  key: keyof T & string
  header: string
  align?: "left" | "right" | "center"
  render?: (row: T) => React.ReactNode
}

export function ReportTable<T extends Record<string, unknown>>({
  columns,
  rows,
  searchKey,
  searchLabel = "Search",
  emptyText = "No records match these filters.",
  maxHeight = 460,
  exportTitle,
}: {
  columns: Column<T>[]
  rows: T[]
  searchKey?: keyof T & string
  searchLabel?: string
  emptyText?: string
  maxHeight?: number
  /** When set, shows an Excel export button; the sheet/title uses this. */
  exportTitle?: string
}) {
  const [query, setQuery] = React.useState("")

  const filtered = React.useMemo(() => {
    if (!searchKey || !query.trim()) return rows
    const q = query.trim().toLowerCase()
    return rows.filter((r) => String(r[searchKey] ?? "").toLowerCase().includes(q))
  }, [rows, searchKey, query])

  return (
    <div className="flex flex-col gap-3">
      {(searchKey || exportTitle) && (
        <div className="flex items-center justify-between gap-2">
          {searchKey ? (
            <div className="relative max-w-xs flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchLabel}
                className="pl-8"
              />
            </div>
          ) : (
            <span />
          )}
          {exportTitle && (
            <ExportButton
              title={exportTitle}
              columns={columns.map((c) => ({ key: c.key, header: c.header }))}
              rows={filtered}
              label="Export"
            />
          )}
        </div>
      )}
      <div className="overflow-auto rounded-lg border" style={{ maxHeight }}>
        <Table>
          <TableHeader className="sticky top-0 bg-primary">
            <TableRow className="hover:bg-primary">
              {columns.map((c) => (
                <TableHead
                  key={c.key}
                  className={cn(
                    "text-primary-foreground",
                    c.align === "right" && "text-right",
                    c.align === "center" && "text-center",
                  )}
                >
                  {c.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="py-8 text-center text-sm text-muted-foreground">
                  {emptyText}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((row, i) => (
                <TableRow key={i}>
                  {columns.map((c) => (
                    <TableCell
                      key={c.key}
                      className={cn(
                        c.align === "right" && "text-right tabular-nums",
                        c.align === "center" && "text-center",
                      )}
                    >
                      {c.render ? c.render(row) : String(row[c.key] ?? "")}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
