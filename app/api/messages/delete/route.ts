// app/api/messages/delete/route.ts
// POST { ids: number[] } -> delete one or more of the caller's own messages,
// removing any attachment files too.
import { NextResponse } from "next/server";
import { getUser } from "@/lib/session";
import { deleteMessages } from "@/lib/messages";
import { deleteAttachment } from "@/lib/message-attachments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const { ids } = (body ?? {}) as { ids?: unknown };
  if (!Array.isArray(ids)) {
    return NextResponse.json({ error: "ids array is required." }, { status: 400 });
  }
  const numeric = ids.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0);

  const keys = await deleteMessages(user.id, numeric);
  for (const k of keys) deleteAttachment(k);
  return NextResponse.json({ ok: true, deleted: numeric.length });
}
