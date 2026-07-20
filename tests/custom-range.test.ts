import { describe, it, expect } from "vitest";
import { parseCustomRange, resolveReportRange } from "../lib/reports/period";

describe("parseCustomRange", () => {
  it("parses a valid from..to range", () => {
    const r = parseCustomRange("2026-06-01..2026-06-30");
    expect(r).not.toBeNull();
    expect(r!.dateFrom).toBe("2026-06-01");
    expect(r!.dateTo).toBe("2026-06-30");
    expect(r!.label).toMatch(/Jun/);
  });

  it("accepts a single-day range", () => {
    expect(parseCustomRange("2026-06-15..2026-06-15")).not.toBeNull();
  });

  it("rejects reversed ranges", () => {
    expect(parseCustomRange("2026-06-30..2026-06-01")).toBeNull();
  });

  it("rejects spans longer than a year", () => {
    expect(parseCustomRange("2024-01-01..2026-01-01")).toBeNull();
  });

  it("rejects malformed values", () => {
    for (const bad of ["", "2026-06-01", "2026-06-01..", "..2026-06-01", "garbage", "2026/06/01..2026/06/30"]) {
      expect(parseCustomRange(bad)).toBeNull();
    }
  });
});

describe("resolveReportRange", () => {
  it("routes custom to parseCustomRange", () => {
    expect(resolveReportRange("custom", "2026-06-01..2026-06-30")).not.toBeNull();
  });
  it("routes cadences to periodToRange", () => {
    expect(resolveReportRange("monthly", "2026-06")).not.toBeNull();
    expect(resolveReportRange("daily", "2026-06-15")).not.toBeNull();
  });
});
