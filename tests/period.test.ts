import { describe, it, expect } from "vitest";
import { periodToRange, listPeriods } from "@/lib/reports/period";

describe("periodToRange", () => {
  it("resolves a daily period to a single day", () => {
    const r = periodToRange("daily", "2025-12-30");
    expect(r).toMatchObject({ dateFrom: "2025-12-30", dateTo: "2025-12-30" });
  });

  it("resolves a monthly period to the full month", () => {
    const r = periodToRange("monthly", "2025-02");
    expect(r).toMatchObject({ dateFrom: "2025-02-01", dateTo: "2025-02-28" });
  });

  it("resolves a quarterly period to three months", () => {
    const r = periodToRange("quarterly", "2025-Q4");
    expect(r).toMatchObject({ dateFrom: "2025-10-01", dateTo: "2025-12-31" });
  });

  it("resolves an annual period to the whole year", () => {
    const r = periodToRange("annual", "2025");
    expect(r).toMatchObject({ dateFrom: "2025-01-01", dateTo: "2025-12-31" });
  });

  it("returns null for malformed values", () => {
    expect(periodToRange("monthly", "2025-13")).toBeNull();
    expect(periodToRange("daily", "2025/12/30")).toBeNull();
    expect(periodToRange("quarterly", "2025-Q9")).toBeNull();
    expect(periodToRange("annual", "abcd")).toBeNull();
  });
});

describe("listPeriods", () => {
  it("enumerates each type newest-first within the range", () => {
    const p = listPeriods(new Date("2025-11-01T00:00:00Z"), new Date("2025-12-31T00:00:00Z"));
    expect(p.monthly[0].value).toBe("2025-12");
    expect(p.monthly.at(-1)?.value).toBe("2025-11");
    expect(p.annual[0].value).toBe("2025");
    expect(p.quarterly[0].value).toBe("2025-Q4");
  });
});
