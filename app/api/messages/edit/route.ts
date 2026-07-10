// app/api/messages/edit/route.ts
// POST { id, body } -> edit the text of one of the caller's own messages.
import { NextResponse } from "next/server";
import { getUser } from "@/lib/session";
import { editMessage } from "@/lib/messages";

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
  const { id, body: text } = (body ?? {}) as { id?: unknown; body?: unknown };
  const mid = Number(id);
  if (!Number.isInteger(mid) || mid <= 0 || typeof text !== "string") {
    return NextResponse.json({ error: "id and body are required." }, { status: 400 });
  }

  try {
    const ok = await editMessage(user.id, mid, text);
    if (!ok) return NextResponse.json({ error: "Message not found or not yours." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
