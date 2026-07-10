// app/api/messages/unread/route.ts
// GET -> { total, latest[] } unread summary for the app-wide message notifier
// (the nav badge + the floating bottom-right preview).
import { NextResponse } from "next/server";
import { getUser } from "@/lib/session";
import { getUnreadSummary } from "@/lib/messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await getUnreadSummary(user.id));
}
