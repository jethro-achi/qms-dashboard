// lib/reports/format.ts — render a ReportData as CSV, Excel, or PDF.
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { csvCell } from "../csv";
import type { ReportData, ReportTable } from "./assemble";

export type ReportFormat = "csv" | "xlsx" | "pdf";

export const MIME: Record<ReportFormat, string> = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
};

/** Render a report to bytes in the requested format (single entry point). */
export async function renderReport(d: ReportData, format: ReportFormat): Promise<Buffer> {
  if (format === "csv") return Buffer.from(reportToCsv(d), "utf-8");
  if (format === "xlsx") return reportToXlsx(d);
  return reportToPdf(d);
}

// ---- CSV ---------------------------------------------------------------------
// Cell encoding (RFC-4180 quoting + formula-injection defence) is centralised in
// lib/csv (imported at the top) so every export path shares the same hardening.

export function reportToCsv(d: ReportData): string {
  const lines: string[] = [];
  lines.push(csvCell(d.title));
  lines.push(`Period,${csvCell(d.periodLabel)}`);
  lines.push(`Range,${d.range.dateFrom} to ${d.range.dateTo}`);
  lines.push(`Scope,${csvCell(d.scopeLabel)}`);
  lines.push(`Generated,${csvCell(new Date(d.generatedAt).toLocaleString())}`);
  lines.push("");
  lines.push("KPI Summary");
  lines.push("Metric,Value");
  for (const k of d.kpis) lines.push(`${csvCell(k.label)},${csvCell(k.value)}`);
  for (const t of d.tables) {
    lines.push("");
    lines.push(csvCell(t.title));
    lines.push(t.columns.map((c) => csvCell(c.header)).join(","));
    for (const r of t.rows) lines.push(t.columns.map((c) => csvCell(r[c.key])).join(","));
  }
  return lines.join("\r\n");
}

// ---- Excel -------------------------------------------------------------------

export async function reportToXlsx(d: ReportData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "QMS Analytics";
  wb.created = new Date();

  const s = wb.addWorksheet("Summary");
  s.addRow([d.title]).font = { bold: true, size: 14 };
  s.addRow(["Period", d.periodLabel]);
  s.addRow(["Range", `${d.range.dateFrom} to ${d.range.dateTo}`]);
  s.addRow(["Scope", d.scopeLabel]);
  s.addRow(["Generated", new Date(d.generatedAt).toLocaleString()]);
  s.addRow([]);
  const hr = s.addRow(["Metric", "Value"]);
  hr.font = { bold: true };
  for (const k of d.kpis) s.addRow([k.label, k.value]);
  s.getColumn(1).width = 28;
  s.getColumn(2).width = 30;

  for (const t of d.tables) {
    const name = (t.title.replace(/[:\\/?*[\]]/g, " ").slice(0, 31)) || "Sheet";
    const ws = wb.addWorksheet(name);
    const header = ws.addRow(t.columns.map((c) => c.header));
    header.font = { bold: true, color: { argb: "FFFFFFFF" } };
    header.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF334155" } };
    });
    for (const r of t.rows) ws.addRow(t.columns.map((c) => (r[c.key] ?? "") as ExcelJS.CellValue));
    t.columns.forEach((c, i) => {
      const maxLen = Math.max(c.header.length, ...t.rows.map((r) => String(r[c.key] ?? "").length));
      ws.getColumn(i + 1).width = Math.min(Math.max(maxLen + 2, 10), 50);
    });
    ws.views = [{ state: "frozen", ySplit: 1 }];
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---- PDF ---------------------------------------------------------------------

type Doc = InstanceType<typeof PDFDocument>;

function drawTable(doc: Doc, table: ReportTable) {
  const left = doc.page.margins.left;
  const usableW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const n = table.columns.length;
  const firstW = Math.min(usableW * 0.34, 190);
  const restW = n > 1 ? (usableW - firstW) / (n - 1) : usableW;
  const widths = table.columns.map((_, i) => (i === 0 ? firstW : restW));
  const rowH = 18;

  const drawRow = (cells: (string | number)[], header: boolean) => {
    if (doc.y + rowH > doc.page.height - doc.page.margins.bottom) doc.addPage();
    const y = doc.y;
    if (header) doc.rect(left, y, usableW, rowH).fill("#334155");
    let x = left;
    doc.fontSize(9);
    table.columns.forEach((c, i) => {
      doc
        .fillColor(header ? "#ffffff" : "#111111")
        .font(header ? "Helvetica-Bold" : "Helvetica")
        .text(String(cells[i] ?? ""), x + 4, y + 5, {
          width: widths[i] - 8,
          height: rowH - 4,
          ellipsis: true,
          lineBreak: false,
          align: i === 0 ? "left" : "right",
        });
      x += widths[i];
    });
    doc.fillColor("#000000");
    doc.y = y + rowH;
  };

  drawRow(table.columns.map((c) => c.header), true);
  if (table.rows.length === 0) {
    doc.fontSize(9).fillColor("#777").text("No data for this period.", left + 4, doc.y + 4);
    doc.fillColor("#000").moveDown(0.5);
    return;
  }
  table.rows.forEach((r) => drawRow(table.columns.map((c) => r[c.key]), false));
}

export function reportToPdf(d: ReportData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(18).font("Helvetica-Bold").fillColor("#0f172a").text(d.title);
    doc.moveDown(0.3);
    doc.fontSize(10).font("Helvetica").fillColor("#555555");
    doc.text(`Period: ${d.periodLabel}   (${d.range.dateFrom} to ${d.range.dateTo})`);
    doc.text(`Scope: ${d.scopeLabel}`);
    doc.text(`Generated: ${new Date(d.generatedAt).toLocaleString()}`);
    doc.fillColor("#000000").moveDown(0.8);

    // KPI summary — two columns
    doc.fontSize(12).font("Helvetica-Bold").fillColor("#0f172a").text("Summary");
    doc.fillColor("#000").moveDown(0.4);
    const left = doc.page.margins.left;
    const usableW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const colW = usableW / 2;
    let ky = doc.y;
    d.kpis.forEach((k, i) => {
      const col = i % 2;
      const x = left + col * colW;
      if (col === 0) ky = doc.y;
      doc.fontSize(9).font("Helvetica").fillColor("#555").text(k.label, x, ky, { width: colW - 8 });
      doc.fontSize(11).font("Helvetica-Bold").fillColor("#111").text(k.value, x, ky + 11, { width: colW - 8 });
      if (col === 1 || i === d.kpis.length - 1) doc.y = ky + 30;
    });
    doc.fillColor("#000").moveDown(0.6);

    for (const t of d.tables) {
      if (doc.y > doc.page.height - 140) doc.addPage();
      doc.moveDown(0.5);
      doc.fontSize(12).font("Helvetica-Bold").fillColor("#0f172a").text(t.title);
      doc.fillColor("#000").moveDown(0.3);
      drawTable(doc, t);
    }

    doc.end();
  });
}
