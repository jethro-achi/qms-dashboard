// app/api/reports/run-due/route.ts
// Cron entry point: generates any report schedules that are due. This runs with
// NO user session — it is authorized solely by a shared secret, so your server's
// scheduler (Linux cron / Windows Task Scheduler) can call it, e.g. every 10 min:
//
//   curl -X POST -H "x-cron-key: $CRON_SECRET" https://host/api/reports/run-due
//
// Set CRON_SECRET in the environment. If it is unset the endpoint refuses to run
// (fail closed) so it can never become an open trigger.
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runDueSchedules } from "@/lib/reports/schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function presented(req: Request): string {
  const h = req.headers.get("x-cron-key");
  if (h) return h;
  const auth = req.headers.get("authorization") ?? "";
  return auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : "";
}

function keyOk(req: Request): boolean {
  const secret = process.env.CRON_SECRET ?? "";
  if (!secret) return false; // fail closed: no secret configured -> no access
  const given = presented(req);
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json(
      { error: "Report scheduling is not configured (CRON_SECRET is unset)." },
      { status: 503 },
    );
  }
  if (!keyOk(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const result = await runDueSchedules();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
