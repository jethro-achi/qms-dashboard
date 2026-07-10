// scripts/seed-user.mjs
// -----------------------------------------------------------------------------
// Add an ADDITIONAL user from the command line. The FIRST admin is created by
// the /setup wizard, which also writes the DB connection details this script
// reuses — so there's a single source of truth for credentials. This:
//   1. hashes the password with Argon2id,
//   2. inserts the user + role + branch scope into the app DB.
//
// Usage:
//   node scripts/seed-user.mjs "you@bank.co" "Full Name" "StrongPassw0rd!" ANALYST "1,2,3"
//   (branch list is ignored for ADMIN, who sees everything)
//
// Reads connection details from the setup config file (default ./data/
// app-config.json; override with APP_CONFIG_DIR). MySQL only for now — for a
// SQL Server app DB, add users via SQL or a future admin UI.
// -----------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { hash } from "@node-rs/argon2";

const [, , email, fullName, password, role = "TELLER", branchCsv = ""] = process.argv;

if (!email || !fullName || !password) {
  console.error('Usage: node scripts/seed-user.mjs "email" "Full Name" "password" [ROLE] ["1,2,3"]');
  process.exit(1);
}

const validRoles = ["SUPER_ADMIN", "ADMIN", "BRANCH_OPS"];
if (!validRoles.includes(role)) {
  console.error(`Role must be one of: ${validRoles.join(", ")}`);
  process.exit(1);
}

// Branches are QMS branch UUIDs (comma-separated).
const branchIds = branchCsv
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

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
  console.error(
    `This script only supports a MySQL app DB (configured engine: ${config.engine}). ` +
      "Add users via SQL for SQL Server.",
  );
  process.exit(1);
}

const conn = await mysql.createConnection({
  host: config.host,
  port: Number(config.port ?? 3306),
  user: config.user,
  password: config.password,
  database: config.database,
  ssl: config.ssl ? { rejectUnauthorized: true } : undefined,
});

try {
  // Argon2id with sensible cost. Tune memory/time to your hardware.
  const passwordHash = await hash(password, {
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
  await conn.beginTransaction();
  const [res] = await conn.execute(
    `INSERT INTO app_users (email, full_name, password_hash, role, is_active)
     VALUES (?, ?, ?, ?, 1)`,
    [email.toLowerCase(), fullName, passwordHash, role],
  );
  const userId = res.insertId;

  for (const b of branchIds) {
    await conn.execute(
      "INSERT INTO app_user_branches (user_id, branch_id) VALUES (?, ?)",
      [userId, b],
    );
  }
  await conn.commit();

  console.log("\n✅ User created.");
  console.log(`   id:     ${userId}`);
  console.log(`   email:  ${email}`);
  console.log(`   role:   ${role}`);
  const seesAll = role === "SUPER_ADMIN" || role === "ADMIN";
  console.log(`   scope:  ${seesAll ? "ALL branches" : branchIds.join(", ") || "(none)"}\n`);
} catch (err) {
  await conn.rollback().catch(() => {});
  console.error("Seed failed:", err.message);
  process.exit(1);
} finally {
  await conn.end();
}
