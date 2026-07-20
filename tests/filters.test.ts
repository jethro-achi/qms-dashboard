import { describe, it, expect } from "vitest";
import { parseFilters, hasActiveFilters, withTodayResolved, EMPTY_FILTERS } from "@/lib/analytics/filters";

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

describe("withTodayResolved — 'Default to today's data'", () => {
  describe("app-wide default OFF (per-user toggle is visible)", () => {
    it("defaults to history when the user has never touched the toggle", () => {
      expect(withTodayResolved({}, false).today).toBe(false);
    });

    it("persists the user's own choice either way", () => {
      expect(withTodayResolved({ today: true }, false).today).toBe(true);
      expect(withTodayResolved({ today: false }, false).today).toBe(false);
    });
  });

  describe("app-wide default ON (a per-user starting value, not a lock)", () => {
    it("starts a user with no stored choice on today", () => {
      expect(withTodayResolved({}, true).today).toBe(true);
    });

    // The whole point of the per-user model: the app-wide default only seeds
    // users who haven't chosen. A user who turned Today OFF stays off — the
    // super admin's setting never overrides their own choice.
    it("respects a user's own 'today: false' over the app-wide default", () => {
      expect(withTodayResolved({ today: false }, true).today).toBe(false);
    });

    it("respects a user's own 'today: true' too", () => {
      expect(withTodayResolved({ today: true }, true).today).toBe(true);
    });
  });

  describe("an explicit date range is the escape hatch", () => {
    it("beats today mode even when the app-wide default is on", () => {
      expect(withTodayResolved({ dateFrom: "2026-01-01" }, true).today).toBe(false);
      expect(withTodayResolved({ dateTo: "2026-01-31" }, true).today).toBe(false);
    });

    it("beats the user's own today toggle", () => {
      expect(withTodayResolved({ today: true, dateFrom: "2026-01-01" }, false).today).toBe(false);
    });

    it("preserves the rest of the filters", () => {
      const out = withTodayResolved({ dateFrom: "2026-01-01", branchIds: ["b1"] }, true);
      expect(out.dateFrom).toBe("2026-01-01");
      expect(out.branchIds).toEqual(["b1"]);
    });
  });
});
