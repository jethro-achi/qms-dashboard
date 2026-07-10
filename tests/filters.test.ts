import { describe, it, expect } from "vitest";
import { parseFilters, hasActiveFilters, EMPTY_FILTERS } from "@/lib/analytics/filters";

describe("parseFilters — input sanitisation", () => {
  it("returns empty for null/undefined/garbage", () => {
    expect(parseFilters(null)).toEqual(EMPTY_FILTERS);
    expect(parseFilters(undefined)).toEqual(EMPTY_FILTERS);
    expect(parseFilters("not json")).toEqual(EMPTY_FILTERS);
  });

  it("accepts a well-formed filter object", () => {
    const f = parseFilters(JSON.stringify({ dateFrom: "2025-01-01", branchIds: ["b1"] }));
    expect(f).toEqual({ dateFrom: "2025-01-01", branchIds: ["b1"] });
  });

  it("rejects malformed dates (whole payload fails closed)", () => {
    expect(parseFilters(JSON.stringify({ dateFrom: "01/01/2025" }))).toEqual(EMPTY_FILTERS);
    expect(parseFilters(JSON.stringify({ dateFrom: "2025-1-1" }))).toEqual(EMPTY_FILTERS);
  });

  it("strips unknown keys", () => {
    const f = parseFilters(JSON.stringify({ statuses: ["Served"], evil: "<script>" }));
    expect(f).toEqual({ statuses: ["Served"] });
    expect((f as Record<string, unknown>).evil).toBeUndefined();
  });

  it("rejects wrong types for array fields", () => {
    expect(parseFilters(JSON.stringify({ branchIds: "b1" }))).toEqual(EMPTY_FILTERS);
    expect(parseFilters(JSON.stringify({ statuses: [123] }))).toEqual(EMPTY_FILTERS);
  });
});

describe("hasActiveFilters", () => {
  it("is false for empty, true when any dimension is set", () => {
    expect(hasActiveFilters({})).toBe(false);
    expect(hasActiveFilters({ branchIds: [] })).toBe(false);
    expect(hasActiveFilters({ branchIds: ["b1"] })).toBe(true);
    expect(hasActiveFilters({ dateTo: "2025-01-01" })).toBe(true);
  });
});
