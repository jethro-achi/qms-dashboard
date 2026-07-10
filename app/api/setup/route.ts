// app/api/setup/route.ts
// -----------------------------------------------------------------------------
// First-run provisioning endpoint. It is reachable WITHOUT authentication, but
// only while the app is unconfigured — once data/app-config.json exists it hard
// 409s. That single-shot property is the security boundary: an attacker can't
// use it to point a live install at a rogue database.
//
// Flow: validate -> connect (proves the credentials + engine work) ->
// create app tables -> create first super admin (only if the DB has no users
// yet) -> persist credentials. Credentials are written LAST, so any failure
// leaves the app still unconfigured and the wizard retryable.
//
// The wizard's separate "Test connection" button hits POST /api/setup/test,
// which validates + pings only (no writes).
// -----------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { isConfigured, writeAppConfigOnce } from "@/lib/app-config";
import { createAdapter } from "@/lib/db-adapters";
import { createFirstSuperAdmin, hasAnyUser, initializeAppSchema } from "@/lib/setup";
import { FullSetupSchema, toCredentials } from "@/lib/setup-schema";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ configured: isConfigured() });
}

export async function POST(req: Request) {
  if (isConfigured()) {
    return NextResponse.json(
      { error: "The application is already configured." },
      { status: 409 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = FullSetupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { admin, ...dbFields } = parsed.data;
  const credentials = toCredentials(dbFields);

  const adapter = createAdapter(credentials);
  try {
    // 1. Prove we can reach the database with these credentials + engine.
    try {
      await adapter.ping();
    } catch (err) {
      return NextResponse.json(
        { error: `Could not connect to the database: ${(err as Error).message}` },
        { status: 400 },
      );
    }

    // 2. Create the application tables (idempotent).
    await initializeAppSchema(adapter);

    // 3. Create the first super admin, unless users already exist (e.g. the
    //    schema was pre-seeded out of band). Never create a duplicate.
    if (!(await hasAnyUser(adapter))) {
      // Coerce to strings explicitly: with this project's non-strict tsconfig
      // zod infers these as optional even though the schema requires them.
      await createFirstSuperAdmin(adapter, {
        email: String(admin.email),
        fullName: String(admin.fullName),
        password: String(admin.password),
      });
    }

    // 4. Persist credentials LAST — this is what flips the app to "configured".
    writeAppConfigOnce(credentials);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: `Setup failed: ${(err as Error).message}` },
      { status: 500 },
    );
  } finally {
    await adapter.close().catch(() => {});
  }
}
