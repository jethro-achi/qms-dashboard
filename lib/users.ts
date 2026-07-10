// lib/users.ts
// Super-admin user administration against the app DB. Branch assignments are
// QMS branch UUIDs stored in app_user_branches; they only apply to
// branch-scoped roles (roles that don't see all branches).
import { hash as argonHash } from "@node-rs/argon2";
import { appQuery, appTransaction, appDb } from "./db";
import { isRole, seesAllBranches, type Role } from "./rbac";

export interface ManagedUser {
  id: number;
  email: string;
  fullName: string;
  role: Role;
  isActive: boolean;
  branchIds: string[];
  lastLogin: string | null;
}

const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

interface UserRow {
  id: number;
  email: string;
  full_name: string;
  role: Role;
  is_active: 0 | 1 | boolean;
  last_login: string | Date | null;
}
interface BranchRow {
  user_id: number;
  branch_id: string;
}

export async function listUsers(): Promise<ManagedUser[]> {
  const [users, branches] = await Promise.all([
    appQuery<UserRow>("SELECT id, email, full_name, role, is_active, last_login FROM app_users ORDER BY full_name"),
    appQuery<BranchRow>("SELECT user_id, branch_id FROM app_user_branches"),
  ]);
  const byUser = new Map<number, string[]>();
  for (const b of branches) {
    const list = byUser.get(Number(b.user_id)) ?? [];
    list.push(b.branch_id);
    byUser.set(Number(b.user_id), list);
  }
  return users.map((u) => ({
    id: Number(u.id),
    email: u.email,
    fullName: u.full_name,
    role: u.role,
    isActive: Boolean(u.is_active),
    branchIds: byUser.get(Number(u.id)) ?? [],
    lastLogin: u.last_login ? new Date(u.last_login as string).toISOString() : null,
  }));
}

async function idByEmail(email: string): Promise<number | null> {
  const rows =
    appDb().dialect === "mssql"
      ? await appQuery<{ id: number }>("SELECT TOP 1 id FROM app_users WHERE email = ?", [email])
      : await appQuery<{ id: number }>("SELECT id FROM app_users WHERE email = ? LIMIT 1", [email]);
  return rows[0] ? Number(rows[0].id) : null;
}

export interface CreateUserInput {
  email: string;
  fullName: string;
  password: string;
  role: Role;
  branchIds: string[];
}

export async function createUser(input: CreateUserInput): Promise<void> {
  const email = input.email.toLowerCase().trim();
  const passwordHash = await argonHash(input.password, ARGON);
  const branchIds = seesAllBranches(input.role) ? [] : dedupe(input.branchIds);

  await appTransaction(async (tx) => {
    await tx.query(
      `INSERT INTO app_users (email, full_name, password_hash, role, is_active)
       VALUES (?, ?, ?, ?, 1)`,
      [email, input.fullName.trim(), passwordHash, input.role],
    );
    const rows =
      tx.dialect === "mssql"
        ? await tx.query<{ id: number }>("SELECT TOP 1 id FROM app_users WHERE email = ?", [email])
        : await tx.query<{ id: number }>("SELECT id FROM app_users WHERE email = ? LIMIT 1", [email]);
    const id = Number(rows[0]?.id);
    for (const b of branchIds) {
      await tx.query("INSERT INTO app_user_branches (user_id, branch_id) VALUES (?, ?)", [id, b]);
    }
  });
}

export interface UpdateUserInput {
  fullName?: string;
  role?: Role;
  isActive?: boolean;
  branchIds?: string[];
}

export async function updateUser(id: number, patch: UpdateUserInput): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.fullName !== undefined) {
    sets.push("full_name = ?");
    params.push(patch.fullName.trim());
  }
  if (patch.role !== undefined) {
    sets.push("role = ?");
    params.push(patch.role);
  }
  if (patch.isActive !== undefined) {
    sets.push("is_active = ?");
    params.push(patch.isActive ? 1 : 0);
  }

  await appTransaction(async (tx) => {
    if (sets.length) {
      await tx.query(`UPDATE app_users SET ${sets.join(", ")} WHERE id = ?`, [...params, id]);
    }
    // Branch set is (re)written when provided; a role that sees all branches
    // has its scope rows cleared.
    const effectiveRole = patch.role;
    const clearBranches = effectiveRole !== undefined && seesAllBranches(effectiveRole);
    if (patch.branchIds !== undefined || clearBranches) {
      await tx.query("DELETE FROM app_user_branches WHERE user_id = ?", [id]);
      const branchIds = clearBranches ? [] : dedupe(patch.branchIds ?? []);
      for (const b of branchIds) {
        await tx.query("INSERT INTO app_user_branches (user_id, branch_id) VALUES (?, ?)", [id, b]);
      }
    }
  });
}

export async function resetPassword(id: number, password: string): Promise<void> {
  const passwordHash = await argonHash(password, ARGON);
  await appQuery(
    "UPDATE app_users SET password_hash = ?, failed_attempts = 0, locked_until = NULL WHERE id = ?",
    [passwordHash, id],
  );
}

export async function deleteUser(id: number): Promise<void> {
  await appQuery("DELETE FROM app_users WHERE id = ?", [id]);
}

/** Count of active super admins — used to prevent locking everyone out. */
export async function superAdminCount(): Promise<number> {
  const rows = await appQuery<{ n: number }>(
    "SELECT COUNT(*) AS n FROM app_users WHERE role = 'SUPER_ADMIN' AND is_active = 1",
  );
  return Number(rows[0]?.n ?? 0);
}

export async function getUserRole(id: number): Promise<Role | null> {
  const rows =
    appDb().dialect === "mssql"
      ? await appQuery<{ role: Role }>("SELECT TOP 1 role FROM app_users WHERE id = ?", [id])
      : await appQuery<{ role: Role }>("SELECT role FROM app_users WHERE id = ? LIMIT 1", [id]);
  const role = rows[0]?.role;
  return isRole(role) ? role : null;
}

function dedupe(a: string[]): string[] {
  return [...new Set(a.map((s) => s.trim()).filter(Boolean))];
}

export { idByEmail };
