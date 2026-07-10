import { describe, it, expect } from "vitest";
import { buildWhere } from "@/lib/analytics/queries";
import type { Principal } from "@/lib/rbac";

const superAdmin: Principal = { userId: 1, role: "SUPER_ADMIN", allowedBranchIds: [] };
const ops: Principal = { userId: 2, role: "BRANCH_OPS", allowedBranchIds: ["b1", "b2"] };
const opsNoBranch: Principal = { userId: 3, role: "BRANCH_OPS", allowedBranchIds: [] };

describe("buildWhere — parameterisation + row-level security", () => {
  it("is unrestricted for a super admin with no filters", () => {
    const w = buildWhere({}, superAdmin);
    expect(w.clause).toBe("");
    expect(w.params).toEqual([]);
  });

  it("applies branch RLS first for a scoped user", () => {
    const w = buildWhere({}, ops);
    expect(w.clause).toBe("WHERE t.branchId IN (?, ?)");
    expect(w.params).toEqual(["b1", "b2"]);
  });

  it("fails closed when a branch user has no branches", () => {
    const w = buildWhere({}, opsNoBranch);
    expect(w.clause).toBe("WHERE 1 = 0");
    expect(w.params).toEqual([]);
  });

  it("binds every client filter value as a parameter (never interpolates)", () => {
    const w = buildWhere(
      { branchIds: ["x"], queueIds: ["q"], statuses: ["Served"], dateFrom: "2025-01-01", dateTo: "2025-01-31" },
      superAdmin,
    );
    // Placeholders only in the SQL text.
    expect(w.clause).toContain("t.branchId IN (?)");
    expect(w.clause).toContain("t.queueId IN (?)");
    expect(w.clause).toContain("t.ticketStatus IN (?)");
    expect(w.clause).toContain("t.createdAt >= ?");
    // Values live in params.
    expect(w.params).toEqual(["x", "q", "Served", "2025-01-01 00:00:00", "2025-01-31 00:00:00"]);
  });

  it("keeps a SQL-injection payload out of the query text", () => {
    const evil = "Served'; DROP TABLE app_users; --";
    const w = buildWhere({ statuses: [evil] }, superAdmin);
    expect(w.clause).not.toContain("DROP TABLE");
    expect(w.clause).toContain("t.ticketStatus IN (?)");
    expect(w.params).toContain(evil);
  });

  it("combines RLS and filters with AND", () => {
    const w = buildWhere({ statuses: ["Served"] }, ops);
    expect(w.clause).toBe("WHERE t.branchId IN (?, ?) AND t.ticketStatus IN (?)");
    expect(w.params).toEqual(["b1", "b2", "Served"]);
  });
});
