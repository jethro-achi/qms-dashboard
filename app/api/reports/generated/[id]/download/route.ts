// app/api/reports/generated/[id]/download/route.ts
// Stream a stored (scheduled) report file to its owner. The DB lookup is scoped
// by user_id, so one user can never fetch another's report.
import { NextResponse } from "next/server";
import { getUser } from "@/lib/session";
import { getGeneratedFileMeta } from "@/lib/reports/schedule";
import { readReportFile } from "@/lib/reports/storage";
import { MIME } from "@/lib/reports/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role === "SUPER_ADMIN")
    return NextResponse.json({ error: "Not available." }, { status: 403 });

  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  const meta = await getGeneratedFileMeta(user.id, id);
  if (!meta) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const data = readReportFile(meta.fileKey);
  if (!data) return NextResponse.json({ error: "File no longer available." }, { status: 410 });

  const blob = new Blob([Uint8Array.from(data)], { type: MIME[meta.format] });
  return new NextResponse(blob, {
    status: 200,
    headers: {
      "Content-Type": MIME[meta.format],
      "Content-Disposition": `attachment; filename="${meta.displayName}"`,
      "Cache-Control": "no-store",
    },
  });
}
