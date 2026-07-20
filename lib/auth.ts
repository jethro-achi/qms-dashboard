// lib/auth.ts
// -----------------------------------------------------------------------------
// Self-managed authentication with a PLUGGABLE identity layer.
//
//   Identity ("who is this?") — one of three, chosen by configuration:
//     * Local password  — Argon2id (memory-hard, resistant to GPU cracking).
//     * LDAP / AD bind   — the user types their AD password into our form and we
//                          bind to the directory (see lib/ldap.ts).
//     * SSO / OIDC       — Microsoft Entra ID (Azure AD). The user authenticates
//                          at Microsoft; our app never sees the password. Enabled
//                          when AUTH_MICROSOFT_ENTRA_ID_ID is set.
//
//   Authorization ("what may they see?") — ALWAYS LOCAL, never from the IdP:
//     role + allowed branch IDs live in app_users / app_user_branches. Whichever
//     way a user proves their identity, they MUST already exist as an ACTIVE
//     app_users row, or sign-in is denied (fail closed). A directory or IdP
//     compromise therefore still can't grant a role or another branch's data —
//     that needs a deliberate, audited change to the local record.
//
// Password hashes live in app_users (see db/schema.sql).
// -----------------------------------------------------------------------------

import NextAuth, { type DefaultSession, type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
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

// The provider id Auth.js assigns to the Entra provider (also the callback path
// segment: /api/auth/callback/microsoft-entra-id).
const ENTRA_ID = "microsoft-entra-id";

/** SSO is active only when an Entra application (client) id is configured. */
export function ssoEnabled(): boolean {
  return Boolean(process.env.AUTH_MICROSOFT_ENTRA_ID_ID);
}

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
    // Optional because the OIDC provider's profile() can't know them yet — the
    // jwt callback loads them from app_users. The Credentials path sets both.
    role?: Role;
    allowedBranchIds?: string[];
  }
}

// --- shared data access (used by every identity path) ------------------------

/** Look up the local account by email (email is UNIQUE → at most one row). */
async function findUserByEmail(email: string): Promise<UserRow | undefined> {
  const rows =
    appDb().dialect === "mssql"
      ? await appQuery<UserRow>("SELECT TOP 1 * FROM app_users WHERE email = ?", [email])
      : await appQuery<UserRow>("SELECT * FROM app_users WHERE email = ? LIMIT 1", [email]);
  return rows[0];
}

/** The QMS branch UUIDs a user may see (empty for all-branch roles is fine). */
async function loadBranchIds(userId: number): Promise<string[]> {
  const branches = await appQuery<BranchRow>(
    "SELECT branch_id FROM app_user_branches WHERE user_id = ?",
    [userId],
  );
  return branches.map((b) => b.branch_id);
}

function isLocked(user: UserRow): boolean {
  return Boolean(user.locked_until && new Date(user.locked_until) > new Date());
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

// --- provider list (Credentials always; Entra when configured) ---------------

const providers: NextAuthConfig["providers"] = [
  Credentials({
    credentials: {
      email: { label: "Email" },
      password: { label: "Password", type: "password" },
    },
    async authorize(raw) {
      const email = String(raw?.email ?? "").toLowerCase().trim();
      const password = String(raw?.password ?? "");
      if (!email || !password) return null;

      const user = await findUserByEmail(email);

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
      if (isLocked(user)) return fail("locked", user.id);

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

      const allowedBranchIds = await loadBranchIds(user.id);

      await registerSuccess(user.id);
      await audit({
        userId: user.id,
        action: "LOGIN_SUCCESS",
        resource: "login",
        details: { email, via: "password" },
        ip: null,
        userAgent: null,
      });

      return {
        id: String(user.id),
        email: user.email,
        name: user.full_name,
        role: user.role,
        allowedBranchIds,
      };
    },
  }),
];

if (ssoEnabled()) {
  providers.push(
    MicrosoftEntraID({
      clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
      clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
      // Pin to the tenant so ONLY that organisation's directory can issue tokens.
      // If unset, Auth.js defaults to the multi-tenant "common" endpoint — the
      // app_users gate still blocks strangers, but production SHOULD set this.
      issuer: process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER,
      // Least privilege: identity claims only. We deliberately do NOT request
      // Graph (User.Read), so we override the provider's default profile()—which
      // otherwise fetches the profile photo from Microsoft Graph—to read the
      // identity straight from the ID-token claims. No Graph permission, no
      // extra network call at sign-in.
      authorization: { params: { scope: "openid profile email" } },
      profile(profile) {
        const email = String(profile.email ?? profile.preferred_username ?? profile.upn ?? "")
          .toLowerCase()
          .trim();
        return {
          id: profile.sub,
          name: profile.name ?? profile.preferred_username ?? null,
          email: email || null,
          image: null,
        };
      },
    }),
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: {
    strategy: "jwt",
    maxAge: Number(process.env.SESSION_MAX_AGE ?? 60 * 30), // 30 min default
  },
  trustHost: true,
  pages: { signIn: "/login" },
  providers,
  callbacks: {
    // Gate for federated (SSO) sign-in: the Credentials path already authorized
    // inside authorize(), so we only enforce the "must be a known, active local
    // user" rule for the Entra provider here. Returning false denies sign-in
    // (fail closed); Auth.js sends the user back to /login?error=AccessDenied.
    async signIn({ user, account }) {
      if (account?.provider !== ENTRA_ID) return true;

      const email = String(user?.email ?? "").toLowerCase().trim();
      const deny = async (reason: string, userId: number | null) => {
        await audit({
          userId,
          action: "LOGIN_FAILURE",
          resource: "login",
          details: { email, reason, via: "sso" },
          ip: null,
          userAgent: null,
        });
        return false;
      };

      if (!email) return deny("sso_no_email", null);
      const row = await findUserByEmail(email);
      if (!row || !row.is_active) return deny("no_user_or_inactive", row?.id ?? null);
      if (isLocked(row)) return deny("locked", row.id);
      return true;
    },

    async jwt({ token, user, account }) {
      // `user` is present only on the initial sign-in call.
      if (user) {
        if (account?.provider === ENTRA_ID) {
          // Identity came from Entra; AUTHORIZATION comes from our records.
          // signIn() already proved the row exists and is active.
          const email = String(user.email ?? "").toLowerCase().trim();
          const row = await findUserByEmail(email);
          if (!row) throw new Error("Authenticated user is not provisioned.");
          token.uid = String(row.id);
          token.role = row.role;
          token.allowedBranchIds = await loadBranchIds(row.id);
          token.name = row.full_name;
          token.email = row.email;
          await registerSuccess(row.id);
          await audit({
            userId: row.id,
            action: "LOGIN_SUCCESS",
            resource: "login",
            details: { email, via: "sso" },
            ip: null,
            userAgent: null,
          });
        } else {
          // Credentials: authorize() already loaded role + branches onto `user`.
          token.uid = String(user.id);
          token.role = (user as { role: Role }).role;
          token.allowedBranchIds = (user as { allowedBranchIds: string[] }).allowedBranchIds;
        }
      }
      return token;
    },

    session({ session, token }) {
      // token.uid is OUR app_users id for every path. token.sub would be the
      // Entra object id for SSO sign-ins, so never use it as the app identity.
      session.user.id = String((token as { uid?: string }).uid ?? token.sub);
      session.user.role = token.role as Role;
      session.user.allowedBranchIds = (token.allowedBranchIds as string[]) ?? [];
      return session;
    },
  },
});
