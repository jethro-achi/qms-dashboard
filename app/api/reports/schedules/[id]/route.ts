// app/api/reports/schedules/[id]/route.ts
// Toggle (PATCH) or delete (DELETE) one of the caller's schedules. All queries
// are scoped by user_id, so users can only touch their own schedules.
import { NextResponse } from "next/server";
import { z } from "zod";
import { getUser } from "@/lib/session";
import { listSchedules, setScheduleActive, deleteSchedule } from "@/lib/reports/schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PatchSchema = z.object({ isActive: z.boolean() });

async function gate() {
  const user = await getUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (user.role === "SUPER_ADMIN")
    return { error: NextResponse.json({ error: "Not available." }, { status: 403 }) };
  return { user };
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { user, error } = await gate();
  if (error) return error;
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  await setScheduleActive(user.id, id, parsed.data.isActive);
  return NextResponse.json({ schedules: await listSchedules(user.id) });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { user, error } = await gate();
  if (error) return error;
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  await deleteSchedule(user.id, id);
  return NextResponse.json({ schedules: await listSchedules(user.id) });
}
