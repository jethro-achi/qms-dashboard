import { describe, it, expect } from "vitest";
import { nextBoundaryAfter, periodValueBefore, computeNextRun, type ScheduleTiming } from "@/lib/reports/schedule";

const T = (o: Partial<ScheduleTiming>): ScheduleTiming => ({
  runHour: 6, runMinute: 0, dayOfMonth: 1, monthOfYear: 1, ...o,
});
const parts = (d: Date) => [d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()];

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

describe("computeNextRun", () => {
  it("daily: next occurrence of the time, rolling to tomorrow once today has passed", () => {
    // 07:30 today is still ahead of 06:00 now
    expect(parts(computeNextRun("daily", T({ runHour: 7, runMinute: 30 }), new Date(2026, 0, 15, 6, 0))))
      .toEqual([2026, 0, 15, 7, 30]);
    // 06:00 today already passed at 09:00 → tomorrow
    expect(parts(computeNextRun("daily", T({ runHour: 6, runMinute: 0 }), new Date(2026, 0, 15, 9, 0))))
      .toEqual([2026, 0, 16, 6, 0]);
  });

  it("monthly: this month if the day/time is ahead, else next month; clamps short months", () => {
    expect(parts(computeNextRun("monthly", T({ dayOfMonth: 20, runHour: 8 }), new Date(2026, 0, 10))))
      .toEqual([2026, 0, 20, 8, 0]);
    expect(parts(computeNextRun("monthly", T({ dayOfMonth: 5, runHour: 8 }), new Date(2026, 0, 10))))
      .toEqual([2026, 1, 5, 8, 0]);
    // day 31 in February clamps to the 28th (2026 is not a leap year)
    expect(parts(computeNextRun("monthly", T({ dayOfMonth: 31 }), new Date(2026, 1, 1))))
      .toEqual([2026, 1, 28, 6, 0]);
  });

  it("quarterly: next quarter-start month (Jan/Apr/Jul/Oct) on the chosen day", () => {
    expect(parts(computeNextRun("quarterly", T({ dayOfMonth: 5 }), new Date(2026, 1, 10))))
      .toEqual([2026, 3, 5, 6, 0]); // Feb → next is April
    expect(parts(computeNextRun("quarterly", T({ dayOfMonth: 5 }), new Date(2026, 10, 1))))
      .toEqual([2027, 0, 5, 6, 0]); // Nov → next is Jan next year
  });

  it("annual: chosen month + day, rolling to next year once passed", () => {
    expect(parts(computeNextRun("annual", T({ monthOfYear: 3, dayOfMonth: 15, runHour: 9 }), new Date(2026, 0, 1))))
      .toEqual([2026, 2, 15, 9, 0]);
    expect(parts(computeNextRun("annual", T({ monthOfYear: 1, dayOfMonth: 1 }), new Date(2026, 5, 1))))
      .toEqual([2027, 0, 1, 6, 0]);
  });
});
