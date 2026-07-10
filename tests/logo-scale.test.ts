import { describe, it, expect } from "vitest";
import { clampLogoScale, LOGO_SCALE_MIN, LOGO_SCALE_MAX, LOGO_SCALE_DEFAULT } from "@/lib/settings";

// The logo-size setting must never break the sidebar layout, so it is clamped
// to a sane range and always resolves to an integer.
describe("clampLogoScale", () => {
  it("keeps in-range values (rounded)", () => {
    expect(clampLogoScale(100)).toBe(100);
    expect(clampLogoScale(87.4)).toBe(87);
  });

  it("clamps below the minimum and above the maximum", () => {
    expect(clampLogoScale(10)).toBe(LOGO_SCALE_MIN);
    expect(clampLogoScale(9999)).toBe(LOGO_SCALE_MAX);
  });

  it("falls back to the default for non-finite input", () => {
    expect(clampLogoScale(NaN)).toBe(LOGO_SCALE_DEFAULT);
    expect(clampLogoScale(Infinity)).toBe(LOGO_SCALE_DEFAULT);
  });
});
