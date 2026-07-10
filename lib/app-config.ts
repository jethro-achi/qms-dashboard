// lib/app-config.ts
// -----------------------------------------------------------------------------
// Persists the application database's connection details, entered once by
// whoever deploys the app via the /setup wizard (see app/setup/).
//
// Why a file instead of env vars: env vars are fixed at process start, so
// changing them means editing the environment and restarting — awkward for a
// "walk through setup in the browser" flow. This file is read on every cold
// start and cached in memory (see lib/db.ts), and is the ONLY source of the
// app DB's credentials once written.
//
// Mount the containing directory as a volume in Docker so it survives
// container restarts/recreation (see next.config.mjs's standalone output).
// -----------------------------------------------------------------------------

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

// Keep this list in sync with lib/db-adapters' registry — adding an engine
// there and here is the only step needed to offer it in the wizard.
export const DB_ENGINES = [
  { value: "mysql", label: "MySQL / MariaDB", defaultPort: 3306 },
  { value: "mssql", label: "Microsoft SQL Server", defaultPort: 1433 },
] as const;

export type DbEngine = (typeof DB_ENGINES)[number]["value"];

export interface AppDbCredentials {
  engine: DbEngine;
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl: boolean;
}

const CONFIG_DIR = process.env.APP_CONFIG_DIR
  ? path.resolve(process.env.APP_CONFIG_DIR)
  : path.join(process.cwd(), "data");
const CONFIG_PATH = path.join(CONFIG_DIR, "app-config.json");

export function isConfigured(): boolean {
  return existsSync(CONFIG_PATH);
}

export function readAppConfig(): AppDbCredentials | null {
  if (!existsSync(CONFIG_PATH)) return null;
  return JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as AppDbCredentials;
}

/**
 * Persist credentials for the FIRST time only. Refuses to overwrite an
 * existing config — reconfiguration is an explicit, out-of-band operation
 * (delete the file and restart), not something an unauthenticated wizard
 * screen should ever be allowed to do again after go-live.
 */
export function writeAppConfigOnce(config: AppDbCredentials): void {
  if (isConfigured()) {
    throw new Error("Application database is already configured.");
  }
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
}
