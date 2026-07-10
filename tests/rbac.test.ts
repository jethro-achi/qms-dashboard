import { describe, it, expect } from "vitest";
import {
  branchScope,
  seesAllBranches,
  canManageUsers,
  canChangeAppSettings,
  canViewPII,
  canExport,
  isRole,
  type Principal,
} from "@/lib/rbac";

const superAdmin: Principal = { userId: 1, role: "SUPER_ADMIN", allowedBranchIds: [] };
const admin: Principal = { userId: 2, role: "ADMIN", allowedBranchIds: [] };
const ops: Principal = { userId: 3, role: "BRANCH_OPS", allowedBranchIds: ["b1", "b2"] };
const opsNoBranch: Principal = { userId: 4, role: "BRANCH_OPS", allowedBranchIds: [] };

describe("role capabilities", () => {
  it("only super admin and admin see all branches", () => {
    expect(seesAllBranches("SUPER_ADMIN")).toBe(true);
    expect(seesAllBranches("ADMIN")).toBe(true);
    expect(seesAllBranches("BRANCH_OPS")).toBe(false);
  });

  it("only super admin manages users and settings", () => {
    expect(canManageUsers("SUPER_ADMIN")).toBe(true);
    expect(canManageUsers("ADMIN")).toBe(false);
    expect(canManageUsers("BRANCH_OPS")).toBe(false);
    expect(canChangeAppSettings("ADMIN")).toBe(false);
  });

  it("all three roles may view PII and export", () => {
    for (const role of ["SUPER_ADMIN", "ADMIN", "BRANCH_OPS"] as const) {
      expect(canViewPII(role)).toBe(true);
      expect(canExport(role)).toBe(true);
    }
  });

  it("isRole only accepts known roles", () => {
    expect(isRole("SUPER_ADMIN")).toBe(true);
    expect(isRole("TELLER")).toBe(false);
    expect(isRole(42)).toBe(false);
  });
});

describe("branchScope (row-level security)", () => {
  it("is unrestricted for all-branch roles", () => {
    expect(branchScope(superAdmin)).toEqual({ clause: "", params: [] });
    expect(branchScope(admin)).toEqual({ clause: "", params: [] });
  });

  it("restricts branch-scoped users to their branches with bound params", () => {
    const s = branchScope(ops);
    expect(s.clause).toBe("branchId IN (?, ?)");
    expect(s.params).toEqual(["b1", "b2"]);
  });

  it("fails CLOSED for a branch user with no branches", () => {
    const s = branchScope(opsNoBranch);
    expect(s.clause).toBe("1 = 0");
    expect(s.params).toEqual([]);
  });

  it("honours a custom column name", () => {
    expect(branchScope(ops, "t.branchId").clause).toBe("t.branchId IN (?, ?)");
  });

  it("never interpolates branch ids into the SQL text", () => {
    const evil: Principal = { userId: 9, role: "BRANCH_OPS", allowedBranchIds: ["'; DROP TABLE app_users; --"] };
    const s = branchScope(evil);
    expect(s.clause).toBe("branchId IN (?)");
    expect(s.clause).not.toContain("DROP TABLE");
    expect(s.params).toEqual(["'; DROP TABLE app_users; --"]);
  });
});
