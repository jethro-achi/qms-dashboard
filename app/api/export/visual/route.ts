// app/api/export/visual/route.ts
// -----------------------------------------------------------------------------
// Generic "export this visual to Excel" endpoint. The client posts the exact
// rows shown in a chart/table plus the visual's title; we return a formatted
// .xlsx whose worksheet is named after the visual (e.g. "Hourly Traffic
// Analysis"), with a title banner, styled header row, and auto-sized columns.
// Authenticated users only.
// -----------------------------------------------------------------------------

import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { z } from "zod";
import { getUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CellValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const Schema = z.object({
  title: z.string().min(1).max(120),
  columns: z.array(z.object({ key: z.string().min(1), header: z.string() })).min(1).max(60),
  rows: z.array(z.record(z.string(), CellValue)).max(100000),
});

/** Excel sheet names: max 31 chars, and none of : \ / ? * [ ]. */
function sheetName(title: string): string {
  return (title.replace(/[:\\/?*[\]]/g, " ").trim().slice(0, 31)) || "Sheet1";
}

export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid export payload." }, { status: 400 });
  }
  const { title, columns, rows } = parsed.data;

  const wb = new ExcelJS.Workbook();
  wb.creator = "QMS Analytics";
  wb.created = new Date();
  const ws = wb.addWorksheet(sheetName(title));

  // Row 1: title banner spanning all columns.
  ws.mergeCells(1, 1, 1, columns.length);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = title;
  titleCell.font = { bold: true, size: 14 };
  titleCell.alignment = { vertical: "middle" };
  ws.getRow(1).height = 22;

  // Row 2: styled header.
  const headerRow = ws.getRow(2);
  headerRow.values = columns.map((c) => c.header);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.alignment = { vertical: "middle" };
  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF334155" } };
  });

  // Data rows from row 3.
  for (const r of rows) {
    ws.addRow(columns.map((c) => (r[c.key] ?? "") as ExcelJS.CellValue));
  }

  // Auto-ish column widths from content length.
  columns.forEach((c, i) => {
    const maxLen = Math.max(
      c.header.length,
      ...rows.map((r) => String(r[c.key] ?? "").length),
    );
    ws.getColumn(i + 1).width = Math.min(Math.max(maxLen + 2, 10), 60);
  });

  ws.views = [{ state: "frozen", ySplit: 2 }];

  const buffer = await wb.xlsx.writeBuffer();
  const safeFile = title.replace(/[^\w\-. ]/g, "_").slice(0, 100) || "export";
  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${safeFile}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
