// lib/db-adapters/types.ts
// -----------------------------------------------------------------------------
// The common surface every engine adapter implements. Application code (auth,
// audit, etc.) is written once against this interface and never imports
// mysql2/mssql directly for the app DB — only lib/db-adapters/* does.
//
// SQL is written with positional `?` placeholders everywhere in the app,
// mysql2-style. Each adapter is responsible for translating that into
// whatever its driver actually wants (mysql2 already speaks `?`; the mssql
// adapter rewrites them into named @pN parameters). This is what lets the
// same query strings run unmodified against either engine.
// -----------------------------------------------------------------------------

import type { DbEngine } from "../app-config";

export interface TxContext {
  readonly dialect: DbEngine;
  query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface DbAdapter extends TxContext {
  /** Run `fn` inside a single transaction/connection; commits on return, rolls back on throw. */
  transaction<T>(fn: (tx: TxContext) => Promise<T>): Promise<T>;
  /** Cheap connectivity check — used by the setup wizard to validate credentials. */
  ping(): Promise<void>;
  close(): Promise<void>;
}
