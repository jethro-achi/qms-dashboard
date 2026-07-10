// app/api/health/route.ts
// -----------------------------------------------------------------------------
// Operational health probe for load balancers, uptime monitors and the Docker
// HEALTHCHECK. Unauthenticated on purpose (a probe has no session) but it leaks
// nothing sensitive — only booleans and a coarse status string.
//
// Two levels, so orchestration can distinguish "the process is alive" from
// "the process can serve real traffic":
//
//   GET /api/health          -> LIVENESS. 200 as long as the Node process can
//                               answer. Used by the container HEALTHCHECK so a
//                               transient DB blip never kills the app container.
//   GET /api/health?deep=1   -> READINESS. Also pings both databases and returns
//                               503 if a dependency the app needs is unreachable.
//                               Use this for load-balancer readiness checks.
// -----------------------------------------------------------------------------

import { NextResponse } from "next/server"
import { isConfigured } from "@/lib/app-config"
import { appQuery, qmsQuery } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function ping(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn()
    return true
  } catch {
    return false
  }
}

export async function GET(req: Request) {
  const configured = isConfigured()
  const deep = new URL(req.url).searchParams.get("deep") === "1"

  const body: {
    status: "ok" | "degraded" | "starting"
    uptimeSeconds: number
    configured: boolean
    checks?: { appDb: boolean; qmsDb: boolean }
  } = {
    status: configured ? "ok" : "starting",
    uptimeSeconds: Math.round(process.uptime()),
    configured,
  }

  if (!deep) {
    // Liveness: always 200 — the process answered.
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } })
  }

  // Readiness: verify the dependencies. The app DB only exists once /setup ran.
  const appDb = configured ? await ping(() => appQuery("SELECT 1")) : false
  const qmsDb = await ping(() => qmsQuery("SELECT 1"))
  body.checks = { appDb, qmsDb }

  const healthy = configured && appDb && qmsDb
  body.status = healthy ? "ok" : "degraded"

  return NextResponse.json(body, {
    status: healthy ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  })
}
