// lib/branding.ts
// The client logo, stored as a file in the config dir (not the DB — it's binary
// and can be large). Served via GET /api/branding/logo and shown top-left in
// the sidebar. Transparent PNG/SVG recommended (no background).
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";

const CONFIG_DIR = process.env.APP_CONFIG_DIR
  ? path.resolve(process.env.APP_CONFIG_DIR)
  : path.join(process.cwd(), "data");
const BRANDING_DIR = path.join(CONFIG_DIR, "branding");
const IMG = path.join(BRANDING_DIR, "logo.img");
const MIME = path.join(BRANDING_DIR, "logo.mime");

const ALLOWED = new Set(["image/png", "image/jpeg", "image/svg+xml", "image/webp", "image/gif"]);
const MAX_BYTES = 1_000_000; // 1 MB

export function hasLogo(): boolean {
  return existsSync(IMG);
}

/** A cache-busting token that changes whenever the logo file changes. */
export function logoVersion(): string {
  try {
    return String(statSync(IMG).mtimeMs | 0);
  } catch {
    return "0";
  }
}

export function readLogo(): { buffer: Buffer; mime: string } | null {
  if (!existsSync(IMG)) return null;
  const mime = existsSync(MIME) ? readFileSync(MIME, "utf8").trim() : "image/png";
  return { buffer: readFileSync(IMG), mime };
}

/** Save a logo from a data URL. Returns an error message, or null on success. */
export function saveLogoFromDataUrl(dataUrl: string): string | null {
  const m = /^data:([a-z0-9.+/-]+);base64,(.+)$/i.exec(dataUrl.trim());
  if (!m) return "Logo must be a base64 data URL.";
  const mime = m[1].toLowerCase();
  if (!ALLOWED.has(mime)) return "Unsupported image type. Use PNG, SVG, JPEG, WebP, or GIF.";
  const buffer = Buffer.from(m[2], "base64");
  if (buffer.byteLength === 0) return "Logo is empty.";
  if (buffer.byteLength > MAX_BYTES) return "Logo is too large (max 1 MB).";
  mkdirSync(BRANDING_DIR, { recursive: true });
  writeFileSync(IMG, buffer);
  writeFileSync(MIME, mime, "utf8");
  return null;
}

export function deleteLogo(): void {
  rmSync(IMG, { force: true });
  rmSync(MIME, { force: true });
}
