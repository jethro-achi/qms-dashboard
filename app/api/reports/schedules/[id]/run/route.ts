// app/api/reports/schedules/[id]/run/route.ts
// "Send now / test" — generate a schedule's report for its most recently
// completed period and email it to the schedule's recipients immediately,
// without waiting for the cron tick. Scoped by user_id (own schedules only).
import { NextResponse } from "next/server";
import { getUser } from "@/lib/session";
import { runScheduleNow, listGeneratedReports } from "@/lib/reports/schedule";
import { auditFromRequest } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role === "SUPER_ADMIN")
    return NextResponse.json({ error: "Not available." }, { status: 403 });

  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  const result = await runScheduleNow(user.id, id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  await auditFromRequest(req, user.id, "REPORT_EMAIL", `schedule:${id}:run-now`, {
    period: result.periodLabel, emailed: result.emailed,
  });

  // Return the refreshed "Ready to download" list so the UI reflects the new file.
  const reports = await listGeneratedReports(user.id);
  return NextResponse.json({
    ok: true,
    periodLabel: result.periodLabel,
    emailed: result.emailed,
    emailConfigured: result.emailConfigured,
    emailError: result.emailError ?? null,
    reports,
  });
}
