"use client"

import * as React from "react"
import { Search, ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react"
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
  /** Columns are sortable by default; set false to opt a column out. */
  sortable?: boolean
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
  const [sort, setSort] = React.useState<{ key: keyof T & string; dir: "asc" | "desc" } | null>(null)

  const filtered = React.useMemo(() => {
    if (!searchKey || !query.trim()) return rows
    const q = query.trim().toLowerCase()
    return rows.filter((r) => String(r[searchKey] ?? "").toLowerCase().includes(q))
  }, [rows, searchKey, query])

  // Sort the currently-filtered rows. Numeric when both cells are numbers,
  // otherwise a locale-aware string compare. Three-state per column: asc → desc
  // → unsorted (original order).
  const sorted = React.useMemo(() => {
    if (!sort) return filtered
    const { key, dir } = sort
    const arr = [...filtered]
    arr.sort((a, b) => {
      const av = a[key]
      const bv = b[key]
      const an = typeof av === "number" ? av : Number(av)
      const bn = typeof bv === "number" ? bv : Number(bv)
      const bothNumeric =
        Number.isFinite(an) && Number.isFinite(bn) &&
        String(av ?? "").trim() !== "" && String(bv ?? "").trim() !== ""
      const cmp = bothNumeric ? an - bn : String(av ?? "").localeCompare(String(bv ?? ""))
      return dir === "asc" ? cmp : -cmp
    })
    return arr
  }, [filtered, sort])

  function toggleSort(key: keyof T & string) {
    setSort((s) =>
      s?.key !== key ? { key, dir: "asc" } : s.dir === "asc" ? { key, dir: "desc" } : null,
    )
  }

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
              rows={sorted}
              label="Export"
            />
          )}
        </div>
      )}
      <div className="overflow-auto rounded-lg border" style={{ maxHeight }}>
        <Table>
          <TableHeader className="sticky top-0 bg-primary">
            <TableRow className="hover:bg-primary">
              {columns.map((c) => {
                const canSort = c.sortable !== false
                const isSorted = sort?.key === c.key
                return (
                  <TableHead
                    key={c.key}
                    aria-sort={isSorted ? (sort!.dir === "asc" ? "ascending" : "descending") : undefined}
                    className={cn(
                      "text-primary-foreground",
                      c.align === "right" && "text-right",
                      c.align === "center" && "text-center",
                    )}
                  >
                    {canSort ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(c.key)}
                        className={cn(
                          "inline-flex items-center gap-1 select-none hover:opacity-80",
                          c.align === "right" && "flex-row-reverse",
                          c.align === "center" && "justify-center",
                        )}
                      >
                        {c.header}
                        {isSorted ? (
                          sort!.dir === "asc" ? (
                            <ChevronUp className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5" />
                          )
                        ) : (
                          <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />
                        )}
                      </button>
                    ) : (
                      c.header
                    )}
                  </TableHead>
                )
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="py-8 text-center text-sm text-muted-foreground">
                  {emptyText}
                </TableCell>
              </TableRow>
            ) : (
              sorted.map((row, i) => (
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
