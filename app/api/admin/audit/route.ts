// app/api/admin/audit/route.ts
// GET -> a page of audit entries + chain-integrity status. Super admin only.
import { NextResponse } from "next/server";
import { getUser } from "@/lib/session";
import { canManageUsers } from "@/lib/rbac";
import { listAuditEntries, verifyChain } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageUsers(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const action = url.searchParams.get("action") || undefined;
  const limit = Number(url.searchParams.get("limit") ?? 100);
  const offset = Number(url.searchParams.get("offset") ?? 0);
  const withIntegrity = url.searchParams.get("integrity") === "1";

  const { entries, total } = await listAuditEntries({ action, limit, offset });
  const integrity = withIntegrity ? await verifyChain() : undefined;
  return NextResponse.json({ entries, total, integrity });
}
