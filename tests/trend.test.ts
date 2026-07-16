import { describe, it, expect } from "vitest";
import { trend } from "@/lib/analytics/home";

// KPI trend rules the product owner cares about: no fabricated numbers off thin
// baselines, no "new", readable caps, and improvement-oriented direction.
describe("trend — KPI comparison logic", () => {
  it("shows a neutral dash (never 'new') when the baseline is too thin", () => {
    const t = trend(50, 3, true, 3, 20); // prevSample 3 < minSample 20
    expect(t.deltaLabel).toBe("—");
    expect(t.direction).toBe("flat");
    expect(t.hasBaseline).toBe(false); // "—" must not be mistaken for a real trend
  });

  it("shows a dash when there is no baseline at all", () => {
    const t = trend(5, 0, true, 0, 0);
    expect(t.deltaLabel).toBe("—");
    expect(t.hasBaseline).toBe(false);
  });

  it("distinguishes a true steady 0% (has baseline) from a missing baseline", () => {
    const steady = trend(1005, 1000, true, 1000, 20);
    expect(steady.direction).toBe("flat");
    expect(steady.hasBaseline).toBe(true); // genuinely steady, not "no data"
  });

  it("computes a signed improvement for higher-is-better metrics", () => {
    const t = trend(120, 100, true, 100, 20);
    expect(t.deltaLabel).toBe("+20%");
    expect(t.direction).toBe("up");
    expect(t.good).toBe(true);
  });

  it("treats a falling metric as an improvement when lower is better", () => {
    // Wait time fell 100 -> 80: good, shown as +20% up.
    const t = trend(80, 100, false, 100, 20);
    expect(t.direction).toBe("up");
    expect(t.good).toBe(true);
    expect(t.deltaLabel).toBe("+20%");
  });

  it("marks a worsening metric red/down", () => {
    const t = trend(80, 100, true, 100, 20); // served fell
    expect(t.direction).toBe("down");
    expect(t.good).toBe(false);
    expect(t.deltaLabel).toBe("-20%");
  });

  it("caps extreme moves at ±300% with a '+' marker", () => {
    const t = trend(1000, 100, true, 100, 20); // +900%
    expect(t.deltaLabel).toBe("+300%+");
  });

  it("treats a sub-1% change as steady 0%", () => {
    const t = trend(1005, 1000, true, 1000, 20);
    expect(t.direction).toBe("flat");
    expect(t.deltaLabel).toBe("0%");
  });
});
