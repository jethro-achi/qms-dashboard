// app/api/reports/recipients/route.ts
// List the admins the caller may share reports with. Both BRANCH_OPS and ADMIN
// may only send to ADMINs; the super admin has no Reports section.
import { NextResponse } from "next/server";
import { getUser } from "@/lib/session";
import { listAdminRecipients } from "@/lib/reports/schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role === "SUPER_ADMIN")
    return NextResponse.json({ error: "Not available." }, { status: 403 });
  return NextResponse.json({ recipients: await listAdminRecipients(user.id) });
}
