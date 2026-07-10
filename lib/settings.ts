// lib/settings.ts
// App-wide settings (super-admin managed), all stored in app_settings:
//   * Appearance: light/dark mode + primary/secondary/accent colours.
//   * Metrics:    the SLA target and the exception (anomaly) threshold, so the
//                 dashboards adjust their visuals when these change.
// Read once and cached (settings change rarely); safe before configuration.
import { appQuery, appDb } from "./db";
import { isConfigured } from "./app-config";

export type Mode = "light" | "dark";
export const MODES: readonly Mode[] = ["light", "dark"];

export interface AppTheme {
  mode: Mode;
  primary: string | null;
  secondary: string | null;
  accent: string | null;
}

export interface AppMetrics {
  slaSeconds: number; // a served ticket meets SLA if its wait is within this
  anomalySeconds: number; // service time above this is flagged as an exception
}

const KEYS = {
  mode: "theme",
  primary: "color_primary",
  secondary: "color_secondary",
  accent: "color_accent",
  slaMinutes: "sla_minutes",
  exceptionMinutes: "exception_minutes",
  logoScale: "logo_scale",
} as const;

// Logo display size as a percentage of the base height (48px). Clamped so the
// logo can never break the sidebar layout.
export const LOGO_SCALE_MIN = 50;
export const LOGO_SCALE_MAX = 200;
export const LOGO_SCALE_DEFAULT = 100;

const DEFAULT_THEME: AppTheme = { mode: "light", primary: null, secondary: null, accent: null };
const DEFAULT_METRICS: AppMetrics = {
  slaSeconds: Number(process.env.QMS_SLA_SECONDS ?? 300),
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

export async function getAppMetrics(): Promise<AppMetrics> {
  const map = await readMap();
  if (!map) return DEFAULT_METRICS;
  const slaMin = posInt(map.get(KEYS.slaMinutes), DEFAULT_METRICS.slaSeconds / 60);
  const excMin = posInt(map.get(KEYS.exceptionMinutes), DEFAULT_METRICS.anomalySeconds / 60);
  return { slaSeconds: slaMin * 60, anomalySeconds: excMin * 60 };
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

export async function saveAppMetrics(patch: { slaMinutes?: number; exceptionMinutes?: number }): Promise<void> {
  if (patch.slaMinutes !== undefined) await upsert(KEYS.slaMinutes, String(Math.max(1, Math.round(patch.slaMinutes))));
  if (patch.exceptionMinutes !== undefined) await upsert(KEYS.exceptionMinutes, String(Math.max(1, Math.round(patch.exceptionMinutes))));
  cache = null;
}
