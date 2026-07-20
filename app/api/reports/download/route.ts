// app/api/reports/download/route.ts
// Generate a period report (daily/monthly/quarterly/annual) as CSV/Excel/PDF.
// Available to every signed-in user EXCEPT the super admin, and always scoped
// to the caller's branches.
import { NextResponse } from "next/server";
import { z } from "zod";
import { getUser, toPrincipal } from "@/lib/session";
import { PERIOD_TYPES, type ReportRangeType } from "@/lib/reports/period";
import { assembleReport } from "@/lib/reports/assemble";
import { reportToCsv, reportToXlsx, reportToPdf, MIME, type ReportFormat } from "@/lib/reports/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.object({
  // The 4 recurring cadences plus "custom" (an arbitrary from–to range).
  type: z.enum([...PERIOD_TYPES, "custom"] as unknown as [string, ...string[]]),
  value: z.string().min(1).max(40),
  format: z.enum(["csv", "xlsx", "pdf"]),
});

function safeName(s: string): string {
  return s.replace(/[^\w\-. ]/g, "_").slice(0, 120) || "report";
}

export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role === "SUPER_ADMIN") {
    return NextResponse.json({ error: "Reports are available to dashboard users, not the super admin." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid report request." }, { status: 400 });
  }
  const { type, value, format } = parsed.data;

  try {
    const report = await assembleReport(type as ReportRangeType, value, toPrincipal(user));
    if (!report) return NextResponse.json({ error: "Invalid period." }, { status: 400 });

    const filename = `${safeName(`${report.title} - ${report.periodLabel}`)}.${format}`;
    const fmt = format as ReportFormat;

    const raw = fmt === "csv" ? reportToCsv(report) : fmt === "xlsx" ? await reportToXlsx(report) : await reportToPdf(report);
    // Copy into a fresh Uint8Array (plain ArrayBuffer) so it's a valid BlobPart.
    const part: BlobPart = typeof raw === "string" ? raw : Uint8Array.from(raw);
    const blob = new Blob([part], { type: MIME[fmt] });

    return new NextResponse(blob, {
      status: 200,
      headers: {
        "Content-Type": MIME[fmt],
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json({ error: `Could not generate report: ${(err as Error).message}` }, { status: 500 });
  }
}
