// lib/message-attachments.ts
// Message attachments are stored as files in the config dir (binary, possibly
// large) with their metadata on the app_messages row. Access is authorized at
// the API layer by the message's sender/recipient, never by guessing the key.
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const CONFIG_DIR = process.env.APP_CONFIG_DIR
  ? path.resolve(process.env.APP_CONFIG_DIR)
  : path.join(process.cwd(), "data");
const DIR = path.join(CONFIG_DIR, "message-attachments");

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB

// A conservative allow-list — documents and images, no executables/scripts.
export const ALLOWED_MIME = new Set<string>([
  "image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml",
  "application/pdf",
  "text/plain", "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "application/zip",
]);

export function isAllowedMime(mime: string): boolean {
  return ALLOWED_MIME.has(mime);
}

export function newAttachmentKey(): string {
  return randomUUID();
}

export function writeAttachment(key: string, data: Buffer): void {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
  writeFileSync(path.join(DIR, key), data);
}

export function readAttachment(key: string): Buffer | null {
  if (key.includes("/") || key.includes("\\") || key.includes("..")) return null;
  const p = path.join(DIR, key);
  return existsSync(p) ? readFileSync(p) : null;
}

export function deleteAttachment(key: string): void {
  if (key.includes("/") || key.includes("\\") || key.includes("..")) return;
  const p = path.join(DIR, key);
  if (existsSync(p)) rmSync(p, { force: true });
}
