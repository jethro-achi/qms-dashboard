// app/api/messages/[userId]/route.ts
// GET -> the conversation between the caller and :userId (and marks it read).
import { NextResponse } from "next/server";
import { getUser } from "@/lib/session";
import { getConversation, markRead } from "@/lib/messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const otherId = Number((await params).userId);
  if (!Number.isInteger(otherId) || otherId <= 0) {
    return NextResponse.json({ error: "Invalid user id." }, { status: 400 });
  }

  const messages = await getConversation(user.id, otherId);
  // Reading the thread clears the unread badge for those messages.
  await markRead(user.id, otherId);
  return NextResponse.json({ messages });
}
