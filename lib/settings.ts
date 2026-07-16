// lib/settings.ts
// App-wide settings (super-admin managed), all stored in app_settings:
//   * Appearance: light/dark mode + primary/secondary/accent colours.
//   * Metrics:    the SLA wait + service targets and the exception (anomaly)
//                 threshold, so the dashboards adjust their visuals when these
//                 change.
// Read once and cached (settings change rarely); safe before configuration.
import { appQuery, appDb } from "./db";
import { isConfigured } from "./app-config";

export type Mode = "light" | "dark";
export const MODES: readonly Mode[] = ["light", "dark"];

// How the QMS ticket data is laid out (see lib/analytics/source.ts).
export type QmsSourceMode = "old" | "new";
export const QMS_SOURCE_MODES: readonly QmsSourceMode[] = ["old", "new"];

export interface AppTheme {
  mode: Mode;
  primary: string | null;
  secondary: string | null;
  accent: string | null;
}

export interface AppMetrics {
  // A served ticket meets SLA only if BOTH hold: its wait is within
  // slaWaitSeconds AND its service is within slaServiceSeconds.
  slaWaitSeconds: number; // default 600 (10 min)
  slaServiceSeconds: number; // default 300 (5 min)
  // A ticket is an exception if its wait OR its service exceeds this.
  anomalySeconds: number; // default 3600 (60 min)
}

const KEYS = {
  mode: "theme",
  primary: "color_primary",
  secondary: "color_secondary",
  accent: "color_accent",
  slaWaitMinutes: "sla_wait_minutes",
  slaServiceMinutes: "sla_service_minutes",
  // Legacy single-threshold key (was the wait target); still read as a fallback
  // for the wait threshold so existing installs keep any custom value.
  slaMinutes: "sla_minutes",
  exceptionMinutes: "exception_minutes",
  logoScale: "logo_scale",
  showTodayDefault: "show_today_default",
  qmsSourceMode: "qms_source_mode",
} as const;

// Logo display size as a percentage of the base height (48px). Clamped so the
// logo can never break the sidebar layout.
export const LOGO_SCALE_MIN = 50;
export const LOGO_SCALE_MAX = 200;
export const LOGO_SCALE_DEFAULT = 100;

const DEFAULT_THEME: AppTheme = { mode: "light", primary: null, secondary: null, accent: null };
const DEFAULT_METRICS: AppMetrics = {
  slaWaitSeconds: Number(process.env.QMS_SLA_WAIT_SECONDS ?? process.env.QMS_SLA_SECONDS ?? 600),
  slaServiceSeconds: Number(process.env.QMS_SLA_SERVICE_SECONDS ?? 300),
  anomalySeconds: Number(process.env.QMS_ANOMALY_SECONDS ?? 3600),
};
const HEX = /^#[0-9a-fA-F]{6}$/;

const TTL_MS = 30_000;
let cache: { at: number; map: Map<string, string> } | null = null;

interface Row {
  setting_key: string;
  setting_value: string;
}

async function readMap(): Promise<Map<string, string> | null> {
  if (!isConfigured()) return null;
  if (cache && Date.now() - cache.at < TTL_MS) return cache.map;
  try {
    const rows = await appQuery<Row>("SELECT setting_key, setting_value FROM app_settings");
    const map = new Map(rows.map((r) => [r.setting_key, r.setting_value]));
    cache = { at: Date.now(), map };
    return map;
  } catch {
    return null; // table may not exist yet
  }
}

export async function getAppTheme(): Promise<AppTheme> {
  const map = await readMap();
  if (!map) return DEFAULT_THEME;
  const hex = (v: string | undefined) => (v && HEX.test(v) ? v : null);
  return {
    mode: map.get(KEYS.mode) === "dark" ? "dark" : "light",
    primary: hex(map.get(KEYS.primary)),
    secondary: hex(map.get(KEYS.secondary)),
    accent: hex(map.get(KEYS.accent)),
  };
}

const posInt = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
};

export function clampLogoScale(n: number): number {
  if (!Number.isFinite(n)) return LOGO_SCALE_DEFAULT;
  return Math.min(LOGO_SCALE_MAX, Math.max(LOGO_SCALE_MIN, Math.round(n)));
}

export async function getLogoScale(): Promise<number> {
  const map = await readMap();
  if (!map) return LOGO_SCALE_DEFAULT;
  const raw = Number(map.get(KEYS.logoScale));
  return Number.isFinite(raw) && raw > 0 ? clampLogoScale(raw) : LOGO_SCALE_DEFAULT;
}

export async function saveLogoScale(scale: number): Promise<void> {
  await upsert(KEYS.logoScale, String(clampLogoScale(scale)));
  cache = null;
}

/**
 * App-wide default for the dashboard's "Show today's data" toggle. When on,
 * every analytics page loads scoped to the current day until the user turns the
 * toggle off. Defaults off, preserving the original all-history behaviour.
 */
/**
 * Which QMS data layout to read (see lib/analytics/source.ts). The env var
 * QMS_SOURCE_MODE is the install default; the super-admin radio overrides it and
 * is stored in app_settings. Falls back to "old" (the original layout).
 */
const ENV_QMS_MODE: QmsSourceMode = process.env.QMS_SOURCE_MODE === "new" ? "new" : "old";

export async function getQmsSourceMode(): Promise<QmsSourceMode> {
  const map = await readMap();
  const v = map?.get(KEYS.qmsSourceMode);
  if (v === "new" || v === "old") return v;
  return ENV_QMS_MODE;
}

export async function saveQmsSourceMode(mode: QmsSourceMode): Promise<void> {
  await upsert(KEYS.qmsSourceMode, mode === "new" ? "new" : "old");
  cache = null;
}

export async function getShowTodayDefault(): Promise<boolean> {
  const map = await readMap();
  if (!map) return false;
  return map.get(KEYS.showTodayDefault) === "1";
}

export async function saveShowTodayDefault(on: boolean): Promise<void> {
  await upsert(KEYS.showTodayDefault, on ? "1" : "0");
  cache = null;
}

export async function getAppMetrics(): Promise<AppMetrics> {
  const map = await readMap();
  if (!map) return DEFAULT_METRICS;
  // Wait target: prefer the new key, fall back to the legacy single SLA key.
  const waitMin = posInt(
    map.get(KEYS.slaWaitMinutes) ?? map.get(KEYS.slaMinutes),
    DEFAULT_METRICS.slaWaitSeconds / 60,
  );
  const svcMin = posInt(map.get(KEYS.slaServiceMinutes), DEFAULT_METRICS.slaServiceSeconds / 60);
  const excMin = posInt(map.get(KEYS.exceptionMinutes), DEFAULT_METRICS.anomalySeconds / 60);
  return { slaWaitSeconds: waitMin * 60, slaServiceSeconds: svcMin * 60, anomalySeconds: excMin * 60 };
}

async function upsert(key: string, value: string): Promise<void> {
  if (appDb().dialect === "mssql") {
    await appQuery(
      `MERGE app_settings AS t USING (SELECT ? AS k, ? AS v) AS s ON t.setting_key = s.k
         WHEN MATCHED THEN UPDATE SET setting_value = s.v
         WHEN NOT MATCHED THEN INSERT (setting_key, setting_value) VALUES (s.k, s.v);`,
      [key, value],
    );
  } else {
    await appQuery(
      `INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
      [key, value],
    );
  }
}

export async function saveAppTheme(patch: Partial<AppTheme>): Promise<void> {
  if (patch.mode) await upsert(KEYS.mode, patch.mode);
  const colorKeys: [keyof AppTheme, string][] = [
    ["primary", KEYS.primary],
    ["secondary", KEYS.secondary],
    ["accent", KEYS.accent],
  ];
  for (const [field, key] of colorKeys) {
    if (field in patch) {
      const v = patch[field] as string | null | undefined;
      await upsert(key, v && HEX.test(v) ? v : "");
    }
  }
  cache = null;
}

export async function saveAppMetrics(patch: {
  slaWaitMinutes?: number;
  slaServiceMinutes?: number;
  exceptionMinutes?: number;
}): Promise<void> {
  const clamp = (n: number) => String(Math.max(1, Math.round(n)));
  if (patch.slaWaitMinutes !== undefined) await upsert(KEYS.slaWaitMinutes, clamp(patch.slaWaitMinutes));
  if (patch.slaServiceMinutes !== undefined) await upsert(KEYS.slaServiceMinutes, clamp(patch.slaServiceMinutes));
  if (patch.exceptionMinutes !== undefined) await upsert(KEYS.exceptionMinutes, clamp(patch.exceptionMinutes));
  cache = null;
}
