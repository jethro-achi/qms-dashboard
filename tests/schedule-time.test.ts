import { describe, it, expect } from "vitest";
import { nextBoundaryAfter, periodValueBefore } from "@/lib/reports/schedule";

// Uses LOCAL Date constructors + getters (the helpers work in local time).
describe("nextBoundaryAfter", () => {
  it("advances to the next day / month / quarter / year boundary", () => {
    const d = nextBoundaryAfter("daily", new Date(2026, 0, 15, 9, 30));
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 0, 16]);

    const m = nextBoundaryAfter("monthly", new Date(2026, 0, 15));
    expect([m.getFullYear(), m.getMonth(), m.getDate()]).toEqual([2026, 1, 1]);

    const q = nextBoundaryAfter("quarterly", new Date(2026, 1, 10)); // Feb -> Q1, next is Q2 (Apr)
    expect([q.getFullYear(), q.getMonth(), q.getDate()]).toEqual([2026, 3, 1]);

    const y = nextBoundaryAfter("annual", new Date(2026, 5, 1));
    expect([y.getFullYear(), y.getMonth(), y.getDate()]).toEqual([2027, 0, 1]);
  });
});

describe("periodValueBefore", () => {
  it("returns the period that just completed before a boundary", () => {
    expect(periodValueBefore("daily", new Date(2026, 0, 1))).toBe("2025-12-31");
    expect(periodValueBefore("monthly", new Date(2026, 0, 1))).toBe("2025-12");
    expect(periodValueBefore("quarterly", new Date(2026, 3, 1))).toBe("2026-Q1");
    expect(periodValueBefore("annual", new Date(2026, 0, 1))).toBe("2025");
  });
});
