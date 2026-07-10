import { describe, it, expect } from "vitest";
import { csvCell, csvRow } from "@/lib/csv";

describe("csvCell — RFC-4180 quoting", () => {
  it("passes plain values through unchanged", () => {
    expect(csvCell("Nairobi")).toBe("Nairobi");
    expect(csvCell(42)).toBe("42");
  });

  it("renders null/undefined as empty", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  it("quotes and doubles embedded quotes/commas/newlines", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('she said "hi"')).toBe('"she said ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
  });
});

describe("csvCell — formula-injection defence (OWASP CSV injection)", () => {
  it("neutralises every dangerous leading character", () => {
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-1")).toBe("'-1");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("\tTAB")).toBe("'\tTAB");
  });

  it("neutralises the classic command-exec payload and still quotes it", () => {
    const payload = '=cmd|\'/c calc\'!A1';
    const out = csvCell(payload);
    expect(out.startsWith("'=")).toBe(true);
  });

  it("does not prefix values where the dangerous char is not first", () => {
    expect(csvCell("total=5")).toBe("total=5");
  });
});

describe("csvRow", () => {
  it("joins encoded cells with commas", () => {
    expect(csvRow(["a", "b,c", "=x"])).toBe('a,"b,c",\'=x');
  });
});
