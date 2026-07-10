// app/api/data/status/route.ts
// GET -> { online, lastUpdatedIso, serverNowIso } for the header live-status
// indicator and the "Refresh now" flow. Branch-scoped to the caller.
import { NextResponse } from "next/server";
import { getUser, toPrincipal } from "@/lib/session";
import { getDataStatus } from "@/lib/analytics/status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const status = await getDataStatus(toPrincipal(user));
  return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
}
