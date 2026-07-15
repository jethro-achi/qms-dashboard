// lib/ldap.ts
// -----------------------------------------------------------------------------
// Optional LDAP / Active Directory authentication.
//
// When LDAP is enabled (LDAP_URL is set), a login password is verified with an
// LDAP *bind* against the bank's directory instead of the local Argon2 hash.
// The directory only proves *identity* — the user must still exist in the app's
// User Management, which is where role + branch access (RBAC / row-level
// security) live. So enabling LDAP changes "how do we check the password"
// and nothing else about authorization.
//
// Two bind styles are supported:
//   simple  — bind directly as the user, DN built from a template (UPN-style).
//   search  — a read-only service account finds the user's DN first, then we
//             re-bind as that DN with the supplied password (standard for AD).
//
// TLS: use ldaps:// (or StartTLS) with a CA cert in production. Never disable
// certificate verification against a real directory.
// -----------------------------------------------------------------------------

import { Client, InvalidCredentialsError, Filter } from "ldapts";
import type { ConnectionOptions } from "node:tls";

/** Raised when the directory can't be reached / is misconfigured — as opposed
 *  to a plain wrong password. Callers treat this as "fail closed", never as a
 *  successful or a normal failed login. */
export class LdapUnavailableError extends Error {}

/** LDAP is active only when a server URL is configured. */
export function ldapEnabled(): boolean {
  return Boolean(process.env.LDAP_URL);
}

/** The super admin can keep using their local password as a break-glass when
 *  the directory is unreachable (default on). Set LDAP_LOCAL_ADMIN_FALLBACK=false
 *  to force even the super admin through LDAP. */
export function ldapLocalAdminFallback(): boolean {
  return process.env.LDAP_LOCAL_ADMIN_FALLBACK !== "false";
}

function tlsOptions(): ConnectionOptions {
  return {
    ca: process.env.LDAP_TLS_CA || undefined,
    // Verification is ON unless explicitly turned off (test/lab only).
    rejectUnauthorized: process.env.LDAP_TLS_REJECT_UNAUTHORIZED !== "false",
  };
}

function newClient(): Client {
  return new Client({
    url: process.env.LDAP_URL as string,
    timeout: Number(process.env.LDAP_TIMEOUT_MS ?? 8000),
    connectTimeout: Number(process.env.LDAP_CONNECT_TIMEOUT_MS ?? 5000),
    tlsOptions: tlsOptions(),
  });
}

/** Upgrade a plaintext ldap:// connection with StartTLS when requested. */
async function maybeStartTls(client: Client): Promise<void> {
  if (process.env.LDAP_START_TLS === "true") {
    await client.startTLS(tlsOptions());
  }
}

/** True if an error is the directory saying "wrong username/password", which is
 *  a normal auth failure — not an outage. */
function isInvalidCredentials(err: unknown): boolean {
  // Match the typed error and, defensively, LDAP result code 49.
  return (
    err instanceof InvalidCredentialsError ||
    (typeof err === "object" && err !== null && (err as { code?: number }).code === 49)
  );
}

/**
 * Verify a login against the directory.
 * @returns true on a successful bind, false on wrong password / unknown user.
 * @throws  LdapUnavailableError if the directory can't be reached or is
 *          misconfigured (service-account bind failed, etc.).
 */
export async function verifyLdapCredentials(login: string, password: string): Promise<boolean> {
  // LDAP simple bind treats an empty password as an anonymous bind, which most
  // servers accept — that would be a silent auth bypass. Reject up front.
  if (!login || !password) return false;

  const mode = (process.env.LDAP_BIND_MODE ?? "simple").toLowerCase();
  return mode === "search" ? searchThenBind(login, password) : simpleBind(login, password);
}

// --- simple bind: build the user's DN from a template and bind as them --------
async function simpleBind(login: string, password: string): Promise<boolean> {
  const template = process.env.LDAP_BIND_DN_TEMPLATE;
  if (!template) {
    throw new LdapUnavailableError("LDAP_BIND_DN_TEMPLATE is not set (required for simple bind).");
  }
  const dn = template.replaceAll("{login}", login);
  const client = newClient();
  try {
    await maybeStartTls(client);
    await client.bind(dn, password);
    return true;
  } catch (err) {
    if (isInvalidCredentials(err)) return false;
    throw new LdapUnavailableError(`LDAP bind failed: ${(err as Error).message}`);
  } finally {
    await client.unbind().catch(() => {});
  }
}

// --- search bind: service account finds the DN, then re-bind as the user ------
async function searchThenBind(login: string, password: string): Promise<boolean> {
  const bindDn = process.env.LDAP_BIND_DN;
  const bindPw = process.env.LDAP_BIND_PASSWORD;
  const base = process.env.LDAP_SEARCH_BASE;
  const filterTpl = process.env.LDAP_SEARCH_FILTER ?? "(|(sAMAccountName={login})(mail={login}))";
  if (!bindDn || !bindPw || !base) {
    throw new LdapUnavailableError(
      "Search bind needs LDAP_BIND_DN, LDAP_BIND_PASSWORD and LDAP_SEARCH_BASE.",
    );
  }

  // 1) Locate the user's DN using the read-only service account.
  const finder = newClient();
  let userDn: string;
  try {
    await maybeStartTls(finder);
    await finder.bind(bindDn, bindPw);
    // Filter.escape() (RFC 4515) neutralises LDAP-injection in the untrusted
    // login value before it goes into the search filter.
    const filter = filterTpl.replaceAll("{login}", Filter.escape(login));
    const { searchEntries } = await finder.search(base, {
      scope: "sub",
      filter,
      attributes: ["dn"],
      sizeLimit: 2,
    });
    if (searchEntries.length !== 1) return false; // unknown or ambiguous → deny
    userDn = searchEntries[0].dn;
  } catch (err) {
    // A failure here is an infrastructure/config problem, not a bad password.
    throw new LdapUnavailableError(`LDAP search failed: ${(err as Error).message}`);
  } finally {
    await finder.unbind().catch(() => {});
  }

  // 2) Bind as the found DN with the supplied password to prove identity.
  const asUser = newClient();
  try {
    await maybeStartTls(asUser);
    await asUser.bind(userDn, password);
    return true;
  } catch (err) {
    if (isInvalidCredentials(err)) return false;
    throw new LdapUnavailableError(`LDAP user bind failed: ${(err as Error).message}`);
  } finally {
    await asUser.unbind().catch(() => {});
  }
}
