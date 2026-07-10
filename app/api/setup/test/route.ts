// app/api/setup/test/route.ts
// -----------------------------------------------------------------------------
// "Test connection" endpoint for the first-run wizard. Validates the database
// fields and attempts a connection, WITHOUT creating tables, an admin, or
// persisting anything. This lets the operator confirm credentials are correct
// before committing to create the super admin.
//
// Like the provisioning endpoint it only works while the app is unconfigured.
// -----------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { isConfigured } from "@/lib/app-config";
import { createAdapter } from "@/lib/db-adapters";
import { DbCredentialsSchema, toCredentials } from "@/lib/setup-schema";

export const runtime = "nodejs";

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

  const parsed = DbCredentialsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid input.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const adapter = createAdapter(toCredentials(parsed.data));
  try {
    await adapter.ping();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `Could not connect: ${(err as Error).message}` },
      { status: 400 },
    );
  } finally {
    await adapter.close().catch(() => {});
  }
}
