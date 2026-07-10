// lib/csv.ts
// One hardened CSV cell encoder for every export path. Two jobs:
//
//  1. RFC-4180 quoting so delimiters / quotes / newlines can't corrupt columns.
//  2. CSV *formula injection* defence: a spreadsheet treats a cell beginning with
//     = + - @ (or a tab/CR) as a formula, so a value like `=cmd|'/c calc'!A1`
//     would execute when the exported file is opened in Excel. We neutralise it
//     by prefixing a single quote, which forces the cell to be read as text.
//     (OWASP "CSV Injection".)

const FORMULA_LEADERS = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  let s = value == null ? "" : String(value);
  if (FORMULA_LEADERS.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Encode a row of values into one CSV line. */
export function csvRow(values: unknown[]): string {
  return values.map(csvCell).join(",");
}
