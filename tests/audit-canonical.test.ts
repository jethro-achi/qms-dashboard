import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { canonical } from "@/lib/audit";

// The audit chain hashes canonical(payload); if canonicalisation weren't
// deterministic, honest re-verification would spuriously fail (or, worse, a
// tampered row could be made to collide). These tests pin the invariants.
describe("canonical — deterministic serialisation", () => {
  it("is independent of object key order", () => {
    expect(canonical({ a: 1, b: 2 })).toBe(canonical({ b: 2, a: 1 }));
  });

  it("recurses into nested objects (details must be inside the hash)", () => {
    const a = canonical({ ts: "t", details: { y: 1, x: 2 } });
    const b = canonical({ details: { x: 2, y: 1 }, ts: "t" });
    expect(a).toBe(b);
    expect(a).toContain('"x":2');
  });

  it("preserves array order", () => {
    expect(canonical([1, 2, 3])).toBe("[1,2,3]");
    expect(canonical([1, 2, 3])).not.toBe(canonical([3, 2, 1]));
  });

  it("handles null and primitives", () => {
    expect(canonical(null)).toBe("null");
    expect(canonical(undefined)).toBe("null");
    expect(canonical("x")).toBe('"x"');
    expect(canonical(5)).toBe("5");
  });

  it("changes when any content changes (tamper detection)", () => {
    const base = { action: "USER_DELETE", details: { targetUserId: 7 } };
    const tampered = { action: "USER_DELETE", details: { targetUserId: 8 } };
    const h = (v: unknown) => createHash("sha256").update(canonical(v)).digest("hex");
    expect(h(base)).not.toBe(h(tampered));
    expect(h(base)).toBe(h({ details: { targetUserId: 7 }, action: "USER_DELETE" }));
  });
});
