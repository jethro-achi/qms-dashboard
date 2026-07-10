// lib/db-adapters/index.ts
// -----------------------------------------------------------------------------
// Engine registry. To support a new database engine:
//   1. add it to DB_ENGINES in lib/app-config.ts,
//   2. write a lib/db-adapters/<engine>-adapter.ts implementing DbAdapter,
//   3. register its factory here.
// Nothing else in the app needs to change — auth, audit and the setup wizard
// all talk to the DbAdapter interface only.
// -----------------------------------------------------------------------------

import type { AppDbCredentials, DbEngine } from "../app-config";
import type { DbAdapter } from "./types";
import { createMysqlAdapter } from "./mysql-adapter";
import { createMssqlAdapter } from "./mssql-adapter";

const FACTORIES: Record<DbEngine, (config: AppDbCredentials) => DbAdapter> = {
  mysql: createMysqlAdapter,
  mssql: createMssqlAdapter,
};

export function createAdapter(config: AppDbCredentials): DbAdapter {
  const factory = FACTORIES[config.engine];
  if (!factory) {
    throw new Error(`Unsupported database engine: ${config.engine}`);
  }
  return factory(config);
}

export type { DbAdapter, TxContext } from "./types";
