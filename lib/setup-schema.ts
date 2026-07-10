// lib/setup-schema.ts
// Shared validation for the first-run wizard, used by both the "test
// connection" endpoint and the full provisioning endpoint so they accept
// exactly the same database fields.
import { z } from "zod";
import { DB_ENGINES, type AppDbCredentials } from "./app-config";

const engineValues = DB_ENGINES.map((e) => e.value) as [string, ...string[]];

export const DbCredentialsSchema = z.object({
  engine: z.enum(engineValues),
  host: z.string().min(1),
  port: z.coerce.number().int().positive().max(65535),
  user: z.string().min(1),
  password: z.string(),
  database: z.string().min(1),
  ssl: z.boolean().default(false),
});

export const FullSetupSchema = DbCredentialsSchema.extend({
  admin: z.object({
    email: z.string().email(),
    fullName: z.string().min(1),
    password: z.string().min(12, "Admin password must be at least 12 characters"),
  }),
});

/** Narrow parsed fields into the AppDbCredentials shape the adapters expect. */
export function toCredentials(fields: z.infer<typeof DbCredentialsSchema>): AppDbCredentials {
  return {
    engine: fields.engine as AppDbCredentials["engine"],
    host: fields.host,
    port: fields.port,
    user: fields.user,
    password: fields.password,
    database: fields.database,
    ssl: fields.ssl,
  };
}
