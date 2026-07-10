// lib/db-adapters/mssql-adapter.ts
import sql from "mssql";
import type { AppDbCredentials } from "../app-config";
import type { DbAdapter, TxContext } from "./types";

/** `?, ?, ...` (mysql2-style) -> `@p0, @p1, ...` (mssql-style), bound by position. */
function toNamedParams(text: string, params: unknown[]): { text: string; bind: (r: sql.Request) => void } {
  let i = 0;
  const rewritten = text.replace(/\?/g, () => `@p${i++}`);
  return {
    text: rewritten,
    bind: (request) => params.forEach((value, idx) => request.input(`p${idx}`, value)),
  };
}

export function createMssqlAdapter(config: AppDbCredentials): DbAdapter {
  const poolPromise: Promise<sql.ConnectionPool> = new sql.ConnectionPool({
    server: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    options: {
      encrypt: config.ssl,
      trustServerCertificate: !config.ssl,
    },
  }).connect();

  function txFor(transaction: sql.Transaction): TxContext {
    return {
      dialect: "mssql",
      async query<T>(text: string, params: unknown[] = []) {
        // A fresh Request per query — a mssql Request can only be executed
        // once, and reusing one would collide `.input()` names across calls.
        const request = new sql.Request(transaction);
        const { text: rewritten, bind } = toNamedParams(text, params);
        bind(request);
        const result = await request.query(rewritten);
        return result.recordset as unknown as T[];
      },
    };
  }

  return {
    dialect: "mssql",

    async query<T>(text: string, params: unknown[] = []) {
      const pool = await poolPromise;
      const { text: rewritten, bind } = toNamedParams(text, params);
      const request = pool.request();
      bind(request);
      const result = await request.query(rewritten);
      return result.recordset as unknown as T[];
    },

    async transaction<T>(fn: (tx: TxContext) => Promise<T>): Promise<T> {
      const pool = await poolPromise;
      const transaction = new sql.Transaction(pool);
      await transaction.begin();
      try {
        const result = await fn(txFor(transaction));
        await transaction.commit();
        return result;
      } catch (err) {
        await transaction.rollback();
        throw err;
      }
    },

    async ping() {
      const pool = await poolPromise;
      await pool.request().query("SELECT 1");
    },

    async close() {
      const pool = await poolPromise;
      await pool.close();
    },
  };
}
