// app/api/reports/schedules/route.ts
// List and create the caller's report schedules. Dashboard users only (the
// super admin has no Reports section).
import { NextResponse } from "next/server";
import { z } from "zod";
import { getUser } from "@/lib/session";
import { PERIOD_TYPES } from "@/lib/reports/period";
import { REPORT_FORMATS, listSchedules, createSchedule } from "@/lib/reports/schedule";
import { auditFromRequest } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  reportType: z.enum(PERIOD_TYPES as unknown as [string, ...string[]]),
  format: z.enum(REPORT_FORMATS as unknown as [string, ...string[]]),
});

async function gate() {
  const user = await getUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (user.role === "SUPER_ADMIN")
    return { error: NextResponse.json({ error: "Reports are available to dashboard users, not the super admin." }, { status: 403 }) };
  return { user };
}

export async function GET() {
  const { user, error } = await gate();
  if (error) return error;
  return NextResponse.json({ schedules: await listSchedules(user.id) });
}

export async function POST(req: Request) {
  const { user, error } = await gate();
  if (error) return error;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid schedule." }, { status: 400 });

  await createSchedule(user.id, {
    name: parsed.data.name,
    reportType: parsed.data.reportType as (typeof PERIOD_TYPES)[number],
    format: parsed.data.format as (typeof REPORT_FORMATS)[number],
  });
  await auditFromRequest(req, user.id, "REPORT_SCHEDULE", "report-schedule", {
    name: parsed.data.name, reportType: parsed.data.reportType, format: parsed.data.format,
  });
  return NextResponse.json({ schedules: await listSchedules(user.id) }, { status: 201 });
}
