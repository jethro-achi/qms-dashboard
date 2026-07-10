// app/api/admin/users/route.ts
// GET  -> list users (super admin only)
// POST -> create a user
import { NextResponse } from "next/server";
import { z } from "zod";
import { getUser } from "@/lib/session";
import { canManageUsers, ROLES } from "@/lib/rbac";
import { createUser, listUsers, idByEmail } from "@/lib/users";
import { auditFromRequest } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const roleValues = ROLES as unknown as [string, ...string[]];

const CreateSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(1).max(255),
  password: z.string().min(12, "Password must be at least 12 characters"),
  role: z.enum(roleValues),
  branchIds: z.array(z.string().min(1)).default([]),
});

async function requireSuper() {
  const user = await getUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!canManageUsers(user.role)) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { user };
}

export async function GET() {
  const { error } = await requireSuper();
  if (error) return error;
  return NextResponse.json({ users: await listUsers() });
}

export async function POST(req: Request) {
  const { user, error } = await requireSuper();
  if (error) return error;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input." }, { status: 400 });
  }
  const data = parsed.data;

  if (await idByEmail(data.email.toLowerCase().trim())) {
    return NextResponse.json({ error: "A user with that email already exists." }, { status: 409 });
  }

  try {
    await createUser({
      email: data.email,
      fullName: data.fullName,
      password: data.password,
      role: data.role as (typeof ROLES)[number],
      branchIds: data.branchIds,
    });
    await auditFromRequest(req, user.id, "USER_CREATE", `user:${data.email.toLowerCase().trim()}`, {
      email: data.email.toLowerCase().trim(),
      fullName: data.fullName,
      role: data.role,
      branchCount: data.branchIds.length,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: `Could not create user: ${(err as Error).message}` }, { status: 500 });
  }
}
