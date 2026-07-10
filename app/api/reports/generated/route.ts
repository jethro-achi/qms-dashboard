// app/api/reports/generated/route.ts
// List the caller's stored (scheduled) reports for the /reports download list.
import { NextResponse } from "next/server";
import { getUser } from "@/lib/session";
import { listGeneratedReports } from "@/lib/reports/schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role === "SUPER_ADMIN")
    return NextResponse.json({ error: "Not available." }, { status: 403 });
  return NextResponse.json({ reports: await listGeneratedReports(user.id) });
}
