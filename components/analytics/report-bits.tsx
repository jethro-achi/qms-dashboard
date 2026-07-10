// components/analytics/report-bits.tsx
// Small shared building blocks for the report pages (server components).
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ExportButton, type ExportColumn } from "./export-button"

export function ChartCard({
  title,
  children,
  exportColumns,
  exportRows,
}: {
  title: string
  children: React.ReactNode
  exportColumns?: ExportColumn[]
  exportRows?: readonly object[]
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-base font-medium">{title}</CardTitle>
        {exportColumns && exportRows && (
          <ExportButton title={title} columns={exportColumns} rows={exportRows} />
        )}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

export function ReportError({ error }: { error: unknown }) {
  return (
    <Card>
      <CardContent className="py-8 text-sm">
        <p className="font-medium text-rose-600 dark:text-rose-400">Could not load this report.</p>
        <p className="mt-1 text-muted-foreground">
          The QMS database could not be reached. Check the <code>QMS_DB_*</code> settings and that the
          database is running.
        </p>
        <p className="mt-2 font-mono text-xs text-muted-foreground">{(error as Error).message}</p>
      </CardContent>
    </Card>
  )
}

/** Compact stat tile used on the report headers (Feedback, Agent Activity). */
export function StatTile({
  label,
  value,
  sub,
}: {
  label: string
  value: string | number
  sub?: string
}) {
  return (
    <Card className="gap-0 py-4">
      <CardHeader className="px-4 pb-1">
        <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4">
        <div className="text-3xl font-bold tabular-nums">{value}</div>
        {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  )
}
