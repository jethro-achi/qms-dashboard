// app/api/admin/settings/route.ts
// Super-admin-only appearance settings: light/dark mode, primary/secondary/
// accent colors, and the client logo.
import { NextResponse } from "next/server";
import { z } from "zod";
import { getUser } from "@/lib/session";
import { canChangeAppSettings } from "@/lib/rbac";
import {
  getAppTheme, getAppMetrics, getLogoScale, getShowTodayDefault,
  saveAppTheme, saveAppMetrics, saveLogoScale, saveShowTodayDefault,
  MODES, LOGO_SCALE_MIN, LOGO_SCALE_MAX, type Mode,
} from "@/lib/settings";
import { deleteLogo, hasLogo, saveLogoFromDataUrl } from "@/lib/branding";
import { auditFromRequest } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const hexOrEmpty = z.string().regex(/^(#[0-9a-fA-F]{6})?$/, "Must be a hex colour like #1e40af");

const Schema = z.object({
  mode: z.enum(MODES as unknown as [string, ...string[]]).optional(),
  primary: hexOrEmpty.optional(),
  secondary: hexOrEmpty.optional(),
  accent: hexOrEmpty.optional(),
  logo: z.string().optional(), // data URL to set, or "" to remove
  logoScale: z.coerce.number().int().min(LOGO_SCALE_MIN).max(LOGO_SCALE_MAX).optional(),
  slaMinutes: z.coerce.number().int().min(1).max(600).optional(),
  exceptionMinutes: z.coerce.number().int().min(1).max(1440).optional(),
  showTodayDefault: z.boolean().optional(),
});

export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ theme: await getAppTheme(), metrics: await getAppMetrics(), logoScale: await getLogoScale(), showTodayDefault: await getShowTodayDefault(), hasLogo: hasLogo() });
}

export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canChangeAppSettings(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input." }, { status: 400 });
  }
  const { mode, primary, secondary, accent, logo, logoScale, slaMinutes, exceptionMinutes, showTodayDefault } = parsed.data;

  // Logo: a data URL sets it, an empty string removes it, undefined leaves it.
  if (logo !== undefined) {
    if (logo === "") {
      deleteLogo();
    } else {
      const err = saveLogoFromDataUrl(logo);
      if (err) return NextResponse.json({ error: err }, { status: 400 });
    }
  }

  await saveAppTheme({
    mode: mode as Mode | undefined,
    ...(primary !== undefined ? { primary: primary || null } : {}),
    ...(secondary !== undefined ? { secondary: secondary || null } : {}),
    ...(accent !== undefined ? { accent: accent || null } : {}),
  });

  if (slaMinutes !== undefined || exceptionMinutes !== undefined) {
    await saveAppMetrics({ slaMinutes, exceptionMinutes });
  }

  if (logoScale !== undefined) {
    await saveLogoScale(logoScale);
  }

  if (showTodayDefault !== undefined) {
    await saveShowTodayDefault(showTodayDefault);
  }

  await auditFromRequest(req, user.id, "SETTINGS_CHANGE", "app-settings", {
    mode, primary, secondary, accent, logoScale,
    logo: logo === undefined ? undefined : logo === "" ? "removed" : "updated",
    slaMinutes, exceptionMinutes, showTodayDefault,
  });

  return NextResponse.json({
    ok: true,
    theme: await getAppTheme(),
    metrics: await getAppMetrics(),
    logoScale: await getLogoScale(),
    showTodayDefault: await getShowTodayDefault(),
    hasLogo: hasLogo(),
  });
}
