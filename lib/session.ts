// lib/session.ts
// Server-side helpers to resolve the authenticated user in RSC/route handlers.
// The real authorization boundary — every server page/route calls one of these
// rather than trusting the coarse middleware cookie check.
import { redirect } from "next/navigation";
import { auth } from "./auth";
import { canManageUsers, type Principal, type Role } from "./rbac";

export interface SessionUser {
  id: number;
  name: string;
  email: string;
  role: Role;
  allowedBranchIds: string[];
}

/** Return the signed-in user, or null. For API routes that answer with JSON. */
export async function getUser(): Promise<SessionUser | null> {
  const session = await auth();
  const u = session?.user;
  if (!u) return null;
  return {
    id: Number(u.id),
    name: u.name ?? u.email ?? "User",
    email: u.email ?? "",
    role: u.role,
    allowedBranchIds: u.allowedBranchIds ?? [],
  };
}

/** Return the signed-in user, or redirect to /login if there's no session. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getUser();
  if (!user) {
    redirect("/login");
  }
  return user;
}

/** Require a super admin (user management, settings); 404-redirects otherwise. */
export async function requireSuperAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (!canManageUsers(user.role)) {
    redirect("/dashboard");
  }
  return user;
}

export function toPrincipal(user: SessionUser): Principal {
  return { userId: user.id, role: user.role, allowedBranchIds: user.allowedBranchIds };
}
