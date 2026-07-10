// app/api/messages/attachment/[id]/route.ts
// GET -> stream a message attachment to a party of that message (sender or
// recipient). Authorization is by the message row, not the opaque file key.
import { NextResponse } from "next/server";
import { getUser } from "@/lib/session";
import { getMessageAttachment } from "@/lib/messages";
import { readAttachment } from "@/lib/message-attachments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  const meta = await getMessageAttachment(user.id, id);
  if (!meta) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const data = readAttachment(meta.key);
  if (!data) return NextResponse.json({ error: "File no longer available." }, { status: 410 });

  // Raster images render inline; SVG and everything else are forced to download,
  // because an SVG opened as a top-level document can execute script (stored XSS).
  const inline = meta.mime.startsWith("image/") && meta.mime !== "image/svg+xml";
  const safe = meta.name.replace(/["\r\n]/g, "_");
  return new NextResponse(new Blob([Uint8Array.from(data)], { type: meta.mime }), {
    status: 200,
    headers: {
      "Content-Type": meta.mime,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${safe}"`,
      "Cache-Control": "private, no-store",
      // Defence-in-depth for user-supplied content served from our origin:
      // never sniff the type, and sandbox any active content if it is ever
      // loaded as a document.
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
