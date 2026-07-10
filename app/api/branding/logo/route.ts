// app/api/branding/logo/route.ts
// Serves the uploaded client logo (or 404 if none). Public — a logo isn't
// sensitive, and it's shown on the login screen too.
import { NextResponse } from "next/server";
import { readLogo } from "@/lib/branding";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const logo = readLogo();
  if (!logo) return new NextResponse(null, { status: 404 });
  return new NextResponse(new Uint8Array(logo.buffer), {
    status: 200,
    headers: {
      "Content-Type": logo.mime,
      "Cache-Control": "no-cache",
      // The logo is admin-uploaded and may be an SVG. It's embedded via <img>
      // (where script can't run), but harden the direct-navigation case: don't
      // sniff, and sandbox so any embedded script is inert as a top-level doc.
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
