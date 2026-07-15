// lib/auth.ts
// -----------------------------------------------------------------------------
// Self-managed authentication.
//   * Passwords verified with Argon2id (memory-hard, resistant to GPU cracking).
//   * On success we load the user's role + allowed branch IDs into the JWT, so
//     every downstream query can enforce RLS without another DB round trip.
//   * Failed attempts increment a lockout counter and are audit-logged.
//
// Password hashes live in app_users (see db/schema.sql).
// -----------------------------------------------------------------------------

import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { verify as argonVerify } from "@node-rs/argon2";
import { appDb, appQuery } from "./db";
import { audit } from "./audit";
import type { Role } from "./rbac";
import {
  ldapEnabled,
  ldapLocalAdminFallback,
  verifyLdapCredentials,
  LdapUnavailableError,
} from "./ldap";

const MAX_FAILED = Number(process.env.AUTH_MAX_FAILED ?? 5);
const LOCKOUT_MINUTES = Number(process.env.AUTH_LOCKOUT_MINUTES ?? 15);

interface UserRow {
  id: number;
  email: string;
  full_name: string;
  password_hash: string;
  role: Role;
  // MySQL TINYINT(1) -> 0|1; SQL Server BIT -> boolean. Treat both as truthy.
  is_active: 0 | 1 | boolean;
  failed_attempts: number;
  locked_until: string | Date | null;
}

interface BranchRow {
  branch_id: string;
}

// Extend the session/JWT types with our fields.
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
      allowedBranchIds: string[];
    } & DefaultSession["user"];
  }
  interface User {
    role: Role;
    allowedBranchIds: string[];
  }
}

async function registerFailure(userId: number): Promise<void> {
  // Increment the counter and, once it crosses the threshold, stamp a lockout.
  // The date arithmetic + conditional differ between engines.
  const lockExpr =
    appDb().dialect === "mssql"
      ? "CASE WHEN failed_attempts + 1 >= ? THEN DATEADD(MINUTE, ?, GETDATE()) ELSE locked_until END"
      : "IF(failed_attempts + 1 >= ?, DATE_ADD(NOW(), INTERVAL ? MINUTE), locked_until)";
  await appQuery(
    `UPDATE app_users
        SET failed_attempts = failed_attempts + 1,
            locked_until = ${lockExpr}
      WHERE id = ?`,
    [MAX_FAILED, LOCKOUT_MINUTES, userId],
  );
}

async function registerSuccess(userId: number): Promise<void> {
  const now = appDb().dialect === "mssql" ? "GETDATE()" : "NOW()";
  await appQuery(
    `UPDATE app_users SET failed_attempts = 0, locked_until = NULL, last_login = ${now} WHERE id = ?`,
    [userId],
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: {
    strategy: "jwt",
    maxAge: Number(process.env.SESSION_MAX_AGE ?? 60 * 30), // 30 min default
  },
  trustHost: true,
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(raw) {
        const email = String(raw?.email ?? "").toLowerCase().trim();
        const password = String(raw?.password ?? "");
        if (!email || !password) return null;

        // email is UNIQUE, so this returns at most one row; the single-row cap
        // is spelled differently per engine.
        const rows =
          appDb().dialect === "mssql"
            ? await appQuery<UserRow>("SELECT TOP 1 * FROM app_users WHERE email = ?", [email])
            : await appQuery<UserRow>("SELECT * FROM app_users WHERE email = ? LIMIT 1", [email]);
        const user = rows[0];

        // Uniform failure handling — don't reveal whether the email exists.
        const fail = async (reason: string, userId: number | null) => {
          if (userId) await registerFailure(userId);
          await audit({
            userId,
            action: "LOGIN_FAILURE",
            resource: "login",
            details: { email, reason },
            ip: null,
            userAgent: null,
          });
          return null;
        };

        if (!user || !user.is_active) return fail("no_user_or_inactive", user?.id ?? null);
        if (user.locked_until && new Date(user.locked_until) > new Date()) {
          return fail("locked", user.id);
        }

        // Password verification. With LDAP enabled the directory checks the
        // password; the local hash is used only for the super-admin break-glass
        // (so a down domain controller can't lock the operator out). Everyone
        // else always goes through the directory.
        const useLocalForAdmin =
          user.role === "SUPER_ADMIN" && ldapLocalAdminFallback() && Boolean(user.password_hash);
        const viaLdap = ldapEnabled() && !useLocalForAdmin;

        let okPassword: boolean;
        if (viaLdap) {
          try {
            okPassword = await verifyLdapCredentials(email, password);
          } catch (err) {
            // Directory unreachable/misconfigured → fail closed, never fall
            // through to another auth path (except the admin break-glass above).
            if (err instanceof LdapUnavailableError) return fail("ldap_unavailable", user.id);
            throw err;
          }
        } else {
          okPassword = await argonVerify(user.password_hash, password).catch(() => false);
        }
        if (!okPassword) return fail(viaLdap ? "ldap_bad_password" : "bad_password", user.id);

        const branches = await appQuery<BranchRow>(
          "SELECT branch_id FROM app_user_branches WHERE user_id = ?",
          [user.id],
        );

        await registerSuccess(user.id);
        await audit({
          userId: user.id,
          action: "LOGIN_SUCCESS",
          resource: "login",
          details: { email },
          ip: null,
          userAgent: null,
        });

        return {
          id: String(user.id),
          email: user.email,
          name: user.full_name,
          role: user.role,
          allowedBranchIds: branches.map((b) => b.branch_id),
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.role = user.role;
        token.allowedBranchIds = user.allowedBranchIds;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = String(token.sub);
      session.user.role = token.role as Role;
      session.user.allowedBranchIds = (token.allowedBranchIds as string[]) ?? [];
      return session;
    },
  },
});
