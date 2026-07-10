// lib/rbac.ts
// -----------------------------------------------------------------------------
// Role-based access control + Row-Level Security.
//
// The golden rule: authorization is enforced in the QUERY, never in the UI.
// Every read against QMS data passes through the branch scope, which appends a
// parameterized `branchId IN (?, ?, ...)` fragment derived from the user's
// session. A branch-scoped user literally cannot receive rows outside their
// scope, no matter what filters the client sends.
//
// Roles (most- to least-privileged):
//   SUPER_ADMIN — everything: manage users + roles, theme, metrics, all branches.
//   ADMIN       — "Dashboard admin": read analytics across ALL branches, but no
//                 super-admin options (no user management / settings).
//   BRANCH_OPS  — read analytics for their assigned branch(es) only (view-only).
//
// Branch IDs are the QMS branch UUIDs (strings).
// -----------------------------------------------------------------------------

export type Role = "SUPER_ADMIN" | "ADMIN" | "BRANCH_OPS";

export const ROLES: readonly Role[] = ["SUPER_ADMIN", "ADMIN", "BRANCH_OPS"];

export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: "Super administrator",
  ADMIN: "Dashboard admin",
  BRANCH_OPS: "Branch ops",
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export interface Principal {
  userId: number;
  role: Role;
  // QMS branch UUIDs this user may see. Ignored for roles that see all branches.
  allowedBranchIds: string[];
}

/** Roles whose branch scope is unrestricted (see every branch). */
const ALL_BRANCH_ROLES: ReadonlySet<Role> = new Set<Role>(["SUPER_ADMIN", "ADMIN"]);

export function seesAllBranches(role: Role): boolean {
  return ALL_BRANCH_ROLES.has(role);
}

/** Only the super admin manages users, roles, and app-wide settings. */
export function canManageUsers(role: Role): boolean {
  return role === "SUPER_ADMIN";
}

/** Only the super admin changes the app theme / metrics / global settings. */
export function canChangeAppSettings(role: Role): boolean {
  return role === "SUPER_ADMIN";
}

/** Roles allowed to view unmasked PII (customer names, account numbers). */
const PII_ROLES: ReadonlySet<Role> = new Set<Role>(["SUPER_ADMIN", "ADMIN", "BRANCH_OPS"]);

export function canViewPII(role: Role): boolean {
  return PII_ROLES.has(role);
}

/** Roles allowed to export data. */
const EXPORT_ROLES: ReadonlySet<Role> = new Set<Role>(["SUPER_ADMIN", "ADMIN", "BRANCH_OPS"]);

export function canExport(role: Role): boolean {
  return EXPORT_ROLES.has(role);
}

export interface ScopeFragment {
  /** SQL fragment to AND into the WHERE clause (empty string = no restriction). */
  clause: string;
  /** Parameters to bind for the fragment. */
  params: string[];
}

/**
 * Build the RLS fragment for a principal against a branch-id column.
 *   all-branch roles -> unrestricted (empty fragment).
 *   branch-scoped     -> restricted to their allowedBranchIds.
 * A branch-scoped user with zero branches gets an always-false clause (fail closed).
 */
export function branchScope(principal: Principal, column = "branchId"): ScopeFragment {
  if (seesAllBranches(principal.role)) return { clause: "", params: [] };
  if (principal.allowedBranchIds.length === 0) return { clause: "1 = 0", params: [] };
  const placeholders = principal.allowedBranchIds.map(() => "?").join(", ");
  return { clause: `${column} IN (${placeholders})`, params: [...principal.allowedBranchIds] };
}
