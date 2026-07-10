// lib/db-adapters/mysql-adapter.ts
import mysql, { type Pool, type PoolConnection } from "mysql2/promise";
import type { AppDbCredentials } from "../app-config";
import type { DbAdapter, TxContext } from "./types";

export function createMysqlAdapter(config: AppDbCredentials): DbAdapter {
  const pool: Pool = mysql.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    waitForConnections: true,
    connectionLimit: 10,
    multipleStatements: false,
    ssl: config.ssl ? { rejectUnauthorized: true } : undefined,
  });

  function txFor(conn: PoolConnection): TxContext {
    return {
      dialect: "mysql",
      async query<T>(sql: string, params: unknown[] = []) {
        const [rows] = await conn.execute(sql, params as unknown[] as never);
        return rows as T[];
      },
    };
  }

  return {
    dialect: "mysql",

    async query<T>(sql: string, params: unknown[] = []) {
      const [rows] = await pool.execute(sql, params as unknown[] as never);
      return rows as T[];
    },

    async transaction<T>(fn: (tx: TxContext) => Promise<T>): Promise<T> {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const result = await fn(txFor(conn));
        await conn.commit();
        return result;
      } catch (err) {
        await conn.rollback();
        throw err;
      } finally {
        conn.release();
      }
    },

    async ping() {
      const conn = await pool.getConnection();
      try {
        await conn.ping();
      } finally {
        conn.release();
      }
    },

    async close() {
      await pool.end();
    },
  };
}
