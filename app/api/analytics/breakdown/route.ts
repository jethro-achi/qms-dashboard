// app/api/analytics/breakdown/route.ts
// Per-visual drill-down: re-group ONE metric by ANY dimension, optionally
// narrowed by a drill path. The filter context comes from the same cookie the
// pages read (so it matches what's on screen), and the branch-scope RLS comes
// from the session — never from the client — so a drill can only narrow, never
// widen, what the caller may see.
import { NextResponse } from "next/server";
import { z } from "zod";
import { cookies } from "next/headers";
import { getUser, toPrincipal } from "@/lib/session";
import { FILTER_COOKIE, parseFilters, withTodayResolved } from "@/lib/analytics/filters";
import { getShowTodayDefault } from "@/lib/settings";
import { getBreakdown, type BreakdownDimension, type BreakdownMetric, type DrillStep } from "@/lib/analytics/breakdown";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Dim = z.enum(["branch", "service", "queue", "agent", "status"]);
const Schema = z.object({
  metric: z.enum(["traffic", "served", "noShows", "avgWait", "avgService", "slaPct", "avgRating"]),
  dimension: Dim,
  drill: z.array(z.object({ dimension: Dim, key: z.string().min(1).max(191) })).max(5).optional(),
});

export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const cookieStore = await cookies();
  const raw = cookieStore.get(FILTER_COOKIE)?.value;
  const filters = withTodayResolved(
    parseFilters(raw ? decodeURIComponent(raw) : raw),
    await getShowTodayDefault(),
  );

  try {
    const rows = await getBreakdown({
      metric: parsed.data.metric as BreakdownMetric,
      dimension: parsed.data.dimension as BreakdownDimension,
      drill: parsed.data.drill as DrillStep[] | undefined,
      filters,
      principal: toPrincipal(user),
    });
    return NextResponse.json({ rows });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
