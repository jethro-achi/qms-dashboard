// app/api/messages/route.ts
// GET  -> the caller's contact list (with unread counts).
// POST -> send a message. Accepts either JSON { recipientId, body } or
//         multipart/form-data (recipientId, body, file) for an attachment.
import { NextResponse } from "next/server";
import { getUser } from "@/lib/session";
import { listContacts, sendMessage, type AttachmentInput } from "@/lib/messages";
import {
  MAX_ATTACHMENT_BYTES, isAllowedMime, newAttachmentKey, writeAttachment, deleteAttachment,
} from "@/lib/message-attachments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const contacts = await listContacts(user.id);
  return NextResponse.json({ contacts });
}

export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const contentType = req.headers.get("content-type") ?? "";
  let rid = NaN;
  let text = "";
  let attachment: AttachmentInput | null = null;

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    rid = Number(form.get("recipientId"));
    text = String(form.get("body") ?? "");
    const file = form.get("file");
    if (file && file instanceof File && file.size > 0) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        return NextResponse.json({ error: "Attachment exceeds the 10 MB limit." }, { status: 400 });
      }
      if (!isAllowedMime(file.type)) {
        return NextResponse.json({ error: `File type not allowed: ${file.type || "unknown"}.` }, { status: 400 });
      }
      const key = newAttachmentKey();
      writeAttachment(key, Buffer.from(await file.arrayBuffer()));
      attachment = { key, name: file.name.slice(0, 255), mime: file.type, size: file.size };
    }
  } else {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }
    const b = (body ?? {}) as { recipientId?: unknown; body?: unknown };
    rid = Number(b.recipientId);
    text = typeof b.body === "string" ? b.body : "";
  }

  if (!Number.isInteger(rid) || rid <= 0) {
    if (attachment) deleteAttachment(attachment.key);
    return NextResponse.json({ error: "recipientId is required." }, { status: 400 });
  }

  try {
    await sendMessage(user.id, rid, text, attachment);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (attachment) deleteAttachment(attachment.key); // don't orphan the file
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
