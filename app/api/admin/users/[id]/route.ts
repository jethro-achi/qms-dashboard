// app/api/admin/users/[id]/route.ts
// PATCH  -> update role / active / name / branches
// DELETE -> remove a user
import { NextResponse } from "next/server";
import { z } from "zod";
import { getUser } from "@/lib/session";
import { canManageUsers, ROLES } from "@/lib/rbac";
import { deleteUser, getUserRole, superAdminCount, updateUser } from "@/lib/users";
import { auditFromRequest } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const roleValues = ROLES as unknown as [string, ...string[]];

const PatchSchema = z.object({
  fullName: z.string().min(1).max(255).optional(),
  role: z.enum(roleValues).optional(),
  isActive: z.boolean().optional(),
  branchIds: z.array(z.string().min(1)).optional(),
});

async function guard(idParam: string) {
  const user = await getUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!canManageUsers(user.role)) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0) return { error: NextResponse.json({ error: "Invalid id." }, { status: 400 }) };
  return { user, id };
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error, user, id } = await guard((await params).id);
  if (error) return error;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input." }, { status: 400 });
  }

  const currentRole = await getUserRole(id);
  if (!currentRole) return NextResponse.json({ error: "User not found." }, { status: 404 });

  // Guard against locking everyone out: don't demote / deactivate the last super admin.
  const losingSuper =
    currentRole === "SUPER_ADMIN" &&
    ((parsed.data.role !== undefined && parsed.data.role !== "SUPER_ADMIN") ||
      parsed.data.isActive === false);
  if (losingSuper && (await superAdminCount()) <= 1) {
    return NextResponse.json({ error: "You can't remove the last active super administrator." }, { status: 400 });
  }
  if (id === user!.id && parsed.data.role !== undefined && parsed.data.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "You can't change your own role." }, { status: 400 });
  }

  await updateUser(id, {
    fullName: parsed.data.fullName,
    role: parsed.data.role as (typeof ROLES)[number] | undefined,
    isActive: parsed.data.isActive,
    branchIds: parsed.data.branchIds,
  });
  await auditFromRequest(req, user!.id, "USER_UPDATE", `user:${id}`, {
    targetUserId: id,
    changes: {
      fullName: parsed.data.fullName,
      role: parsed.data.role,
      isActive: parsed.data.isActive,
      branchIds: parsed.data.branchIds,
    },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error, user, id } = await guard((await params).id);
  if (error) return error;

  if (id === user!.id) {
    return NextResponse.json({ error: "You can't delete your own account." }, { status: 400 });
  }
  const role = await getUserRole(id);
  if (role === "SUPER_ADMIN" && (await superAdminCount()) <= 1) {
    return NextResponse.json({ error: "You can't delete the last super administrator." }, { status: 400 });
  }
  await deleteUser(id);
  await auditFromRequest(req, user!.id, "USER_DELETE", `user:${id}`, { targetUserId: id, role });
  return NextResponse.json({ ok: true });
}
