// app/api/reports/schedules/[id]/route.ts
// Toggle (PATCH) or delete (DELETE) one of the caller's schedules. All queries
// are scoped by user_id, so users can only touch their own schedules.
import { NextResponse } from "next/server";
import { z } from "zod";
import { getUser } from "@/lib/session";
import { PERIOD_TYPES } from "@/lib/reports/period";
import {
  REPORT_FORMATS, listSchedules, setScheduleActive, deleteSchedule, updateSchedule,
} from "@/lib/reports/schedule";
import { auditFromRequest } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PatchSchema = z.object({ isActive: z.boolean() });

// Full edit of a schedule (mirrors the create schema).
const UpdateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  reportType: z.enum(PERIOD_TYPES as unknown as [string, ...string[]]),
  format: z.enum(REPORT_FORMATS as unknown as [string, ...string[]]),
  timing: z
    .object({
      runHour: z.number().int().min(0).max(23),
      runMinute: z.number().int().min(0).max(59),
      dayOfMonth: z.number().int().min(1).max(31),
      monthOfYear: z.number().int().min(1).max(12),
    })
    .partial()
    .optional(),
  recipientIds: z.array(z.number().int().positive()).max(100).optional(),
  emailRecipients: z.array(z.string().trim().email().max(320)).max(50).optional(),
  emailNote: z.string().trim().max(1000).optional(),
});

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
  await auditFromRequest(
    req, user.id, "REPORT_SCHEDULE",
    `report-schedule:${id}:${parsed.data.isActive ? "resume" : "pause"}`,
    { isActive: parsed.data.isActive },
  );
  return NextResponse.json({ schedules: await listSchedules(user.id) });
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
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
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid schedule." }, { status: 400 });

  const ok = await updateSchedule(user.id, id, {
    name: parsed.data.name,
    reportType: parsed.data.reportType as (typeof PERIOD_TYPES)[number],
    format: parsed.data.format as (typeof REPORT_FORMATS)[number],
    timing: parsed.data.timing,
    recipientIds: parsed.data.recipientIds,
    emailRecipients: parsed.data.emailRecipients,
    emailNote: parsed.data.emailNote,
  });
  if (!ok) return NextResponse.json({ error: "Schedule not found." }, { status: 404 });

  await auditFromRequest(req, user.id, "REPORT_SCHEDULE", `report-schedule:${id}:edit`, {
    name: parsed.data.name, reportType: parsed.data.reportType, format: parsed.data.format,
    recipients: parsed.data.recipientIds?.length ?? 0,
    emailRecipients: parsed.data.emailRecipients?.length ?? 0,
  });
  return NextResponse.json({ schedules: await listSchedules(user.id) });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { user, error } = await gate();
  if (error) return error;
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  await deleteSchedule(user.id, id);
  await auditFromRequest(req, user.id, "REPORT_SCHEDULE", `report-schedule:${id}:delete`, {});
  return NextResponse.json({ schedules: await listSchedules(user.id) });
}
