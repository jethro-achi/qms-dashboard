// scripts/reset-password.mjs
// -----------------------------------------------------------------------------
// Reset a user's password from the command line (recovery for a forgotten
// login). Reuses the /setup wizard's connection details in data/app-config.json
// (override the dir with APP_CONFIG_DIR). MySQL app DB only.
//
// Usage:
//   node scripts/reset-password.mjs                 # resets the SUPER_ADMIN
//   node scripts/reset-password.mjs you@bank.co     # resets a specific user
//   node scripts/reset-password.mjs you@bank.co "NewStrongPassw0rd!"  # set explicitly
//
// Also clears the lockout counter and re-activates the account.
// -----------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import mysql from "mysql2/promise";
import { hash } from "@node-rs/argon2";

const [, , emailArg, passwordArg] = process.argv;

const configDir = process.env.APP_CONFIG_DIR
  ? path.resolve(process.env.APP_CONFIG_DIR)
  : path.join(process.cwd(), "data");
const configPath = path.join(configDir, "app-config.json");

let config;
try {
  config = JSON.parse(readFileSync(configPath, "utf8"));
} catch {
  console.error(`Could not read ${configPath}. Run the /setup wizard first.`);
  process.exit(1);
}
if (config.engine !== "mysql") {
  console.error(`This script only supports a MySQL app DB (configured engine: ${config.engine}).`);
  process.exit(1);
}

const newPassword = passwordArg || "Qms-Admin-" + randomBytes(4).toString("hex").toUpperCase();

const conn = await mysql.createConnection({
  host: config.host,
  port: Number(config.port ?? 3306),
  user: config.user,
  password: config.password,
  database: config.database,
  ssl: config.ssl ? { rejectUnauthorized: true } : undefined,
});

try {
  const [users] = await conn.query(
    "SELECT id, email, full_name, role FROM app_users ORDER BY id",
  );
  if (users.length === 0) {
    console.error("No users found. Run the /setup wizard to create the first super admin.");
    process.exit(1);
  }

  const target = emailArg
    ? users.find((u) => u.email.toLowerCase() === emailArg.toLowerCase())
    : users.find((u) => u.role === "SUPER_ADMIN") ?? users[0];

  if (!target) {
    console.error(`No user found with email "${emailArg}". Known users:`);
    for (const u of users) console.error(`  ${u.email} [${u.role}]`);
    process.exit(1);
  }

  const passwordHash = await hash(newPassword, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
  await conn.execute(
    "UPDATE app_users SET password_hash = ?, failed_attempts = 0, locked_until = NULL, is_active = 1 WHERE id = ?",
    [passwordHash, target.id],
  );

  console.log("\n✅ Password reset.");
  console.log(`   email:    ${target.email}`);
  console.log(`   role:     ${target.role}`);
  console.log(`   password: ${newPassword}\n`);
} finally {
  await conn.end();
}
