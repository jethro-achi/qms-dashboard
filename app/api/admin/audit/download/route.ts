// app/api/admin/audit/download/route.ts
// GET -> the audit trail as a CSV file. Super admin only. This is the
// hand-to-the-security-team artifact of who did what and when.
import { NextResponse } from "next/server";
import { getUser } from "@/lib/session";
import { canManageUsers } from "@/lib/rbac";
import { listAuditEntries, AUDIT_ACTION_LABELS } from "@/lib/audit";
import { csvCell } from "@/lib/csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageUsers(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Up to 5000 most-recent entries — plenty for a review export.
  const { entries } = await listAuditEntries({ limit: 500, offset: 0 });
  const all = [...entries];
  for (let offset = 500; all.length < 5000; offset += 500) {
    const { entries: more } = await listAuditEntries({ limit: 500, offset });
    if (more.length === 0) break;
    all.push(...more);
  }

  const header = ["Timestamp", "User", "Email", "Action", "Resource", "Details", "IP", "User agent"];
  const lines = [header.join(",")];
  for (const e of all) {
    lines.push([
      csvCell(e.ts),
      csvCell(e.actorName ?? (e.userId ? `#${e.userId}` : "—")),
      csvCell(e.actorEmail ?? ""),
      csvCell(AUDIT_ACTION_LABELS[e.action] ?? e.action),
      csvCell(e.resource),
      csvCell(JSON.stringify(e.details)),
      csvCell(e.ip ?? ""),
      csvCell(e.userAgent ?? ""),
    ].join(","));
  }
  const body = lines.join("\r\n");
  const filename = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
