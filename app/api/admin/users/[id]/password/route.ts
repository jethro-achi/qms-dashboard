// app/api/admin/users/[id]/password/route.ts
// POST -> reset a user's password (super admin only)
import { NextResponse } from "next/server";
import { z } from "zod";
import { getUser } from "@/lib/session";
import { canManageUsers } from "@/lib/rbac";
import { resetPassword } from "@/lib/users";
import { auditFromRequest } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.object({ password: z.string().min(12, "Password must be at least 12 characters") });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageUsers(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Invalid id." }, { status: 400 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input." }, { status: 400 });
  }

  await resetPassword(id, parsed.data.password);
  // Never log the password itself — only that a reset happened, by whom, for whom.
  await auditFromRequest(req, user.id, "PASSWORD_RESET", `user:${id}`, { targetUserId: id });
  return NextResponse.json({ ok: true });
}
