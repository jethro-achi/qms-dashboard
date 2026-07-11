// app/api/reports/generated/[id]/share/route.ts
// Share one of the caller's generated reports with a set of admin recipients.
// RBAC (admins-only) is enforced in shareReport(); the report must be owned by
// the caller.
import { NextResponse } from "next/server";
import { z } from "zod";
import { getUser } from "@/lib/session";
import { shareReport } from "@/lib/reports/schedule";
import { auditFromRequest } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ShareSchema = z.object({
  recipientIds: z.array(z.number().int().positive()).min(1).max(100),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role === "SUPER_ADMIN")
    return NextResponse.json({ error: "Not available." }, { status: 403 });

  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = ShareSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Pick at least one recipient." }, { status: 400 });

  let added: number;
  try {
    added = await shareReport(user.id, id, parsed.data.recipientIds);
  } catch {
    return NextResponse.json({ error: "Report not found." }, { status: 404 });
  }
  await auditFromRequest(req, user.id, "REPORT_SHARE", "generated-report", {
    reportId: id, recipients: parsed.data.recipientIds.length, added,
  });
  return NextResponse.json({ added });
}
