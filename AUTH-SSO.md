# Authentication & SSO — architecture, status, and options

Where the dashboard stands on sign-in, why it's built the way it is, and the
architecturally correct path to **true SSO** if a client needs it. Written to be
handed to a bank's / NIRA's infosec team.

---

## 1. The honest status, up front

| Tier | What it is | Implemented? |
|---|---|---|
| **Local passwords** | App-managed credentials, Argon2id hashes | ✅ Yes (default) |
| **LDAP / Active Directory** | User types their AD password into our form; we verify it by binding to the directory | ✅ Yes — see [DEPLOY-LDAP.md](DEPLOY-LDAP.md) |
| **SSO — OIDC (Microsoft Entra ID)** | User authenticates at Microsoft; app never sees the password; click-through if already signed in | ✅ Yes — set `AUTH_MICROSOFT_ENTRA_ID_ID` (runbook in §5) |
| **SSO — SAML 2.0** | Same, for SAML-only IdPs (ADFS, etc.) | ⚙️ Via a bridge (§6) — only if the IdP is SAML-only |

All three identity tiers can be enabled at once: a deployment can offer local
passwords, LDAP, and the Microsoft SSO button simultaneously, and each user
takes whichever path applies to them.

**LDAP is not SSO.** They're often conflated because both "use Active Directory,"
but the difference is material to a security review:

- **LDAP bind (what we have):** the user re-enters their AD username + password on
  *our* login form, and our server processes that password to bind to the
  directory. One central credential store, yes — but not single sign-on, and our
  server momentarily handles the AD password.
- **SSO (what we don't have yet):** the user signs in once at the Identity
  Provider (Entra ID / Azure AD, ADFS, Okta, Keycloak…). They're redirected back
  to us with a **signed token**. Our app **never sees the password**, and if
  they already have an IdP session, sign-in is a redirect with no prompt.

---

## 2. The architecture (and why it's the acceptable one)

The design rests on one principle:

> **Authentication is pluggable. Authorization is local and always enforced.**

- **Authentication** = "who is this person?" — answered by local password, LDAP,
  or (future) an SSO IdP. This is the swappable layer.
- **Authorization** = "what may they see?" — their **role** (Super Admin / Admin
  / Branch Ops) and **branch access** live in the app's own `app_users` table.
  Every analytics query is filtered by that record (row-level security,
  fail-closed). See [lib/auth.ts](lib/auth.ts) and [lib/rbac.ts](lib/rbac.ts).

```
                        ┌── local password (Argon2id) ──┐
   who are you?  ───────┼── LDAP / AD bind ─────────────┼──►  identity established
   (pluggable)          └── SSO: OIDC / SAML (future) ──┘            │
                                                                     ▼
   what may you see?  ──────────────────────────────►  app_users: role + branches
   (always local, unchanged)                            → branch-scoped RLS on every query
```

**Why this is the right seam:** because authorization never depends on *how* the
user authenticated, adding SSO is purely an authentication change. No query, no
RBAC rule, no branch-scoping logic changes. A client chooses local / LDAP / SSO
by **configuration**, and the data-security guarantees are identical in all three.

This also means a directory or IdP compromise still can't grant someone Admin
rights or another branch's data — that requires a deliberate change to the local
`app_users` record, which is audited.

---

## 3. What infosec should note about the current LDAP tier

The LDAP integration is sound for what it is (TLS-verified bind, injection-safe
filters, fail-closed, break-glass — see [DEPLOY-LDAP.md](DEPLOY-LDAP.md) §8). The
one architectural caveat to raise proactively:

- **With LDAP, our server processes the user's AD password** (to perform the
  bind). It is never stored or logged, and it travels only over the encrypted
  link — but some bank security teams require that an application **never touch**
  AD credentials at all. That requirement is precisely the argument for SSO,
  where the password stays between the user and the IdP.

If that requirement applies to your client, go to SSO (§4). If it doesn't, LDAP
is a perfectly acceptable, widely-accepted posture.

---

## 4. OIDC (Microsoft Entra ID) — how it's built

Best fit for any client on **Microsoft 365 / Entra ID** (Azure AD) — which covers
most banks — and the same Auth.js OIDC plumbing extends to Okta, Keycloak, Google
Workspace, etc. It drops into the **same provider list** as the existing
Credentials/LDAP path, so nothing downstream changed.

**What happens on a sign-in** (see [lib/auth.ts](lib/auth.ts)):

1. The user clicks **Sign in with Microsoft** on the login page (the button
   appears only when `AUTH_MICROSOFT_ENTRA_ID_ID` is set). They authenticate at
   Microsoft — with the org's own MFA / Conditional Access — and are redirected
   back to `/api/auth/callback/microsoft-entra-id` with a signed token. **Our app
   never sees the password.**
2. The `signIn` callback takes the verified email (`email` → `preferred_username`
   → `upn`, lower-cased) and **looks it up in `app_users`**. No active local
   record → **sign-in is denied and audited** (`LOGIN_FAILURE`, reason
   `no_user_or_inactive`), and the user is bounced back to `/login` with a clear
   message. This is the *same fail-closed authorization gate* the password path
   uses.
3. The `jwt` callback loads **role + branch IDs from `app_users`** (never from
   the token's group/role claims), writes them into the session JWT, resets the
   lockout counter, stamps `last_login`, and audits `LOGIN_SUCCESS` (`via: sso`).
4. Every downstream query enforces RLS from that session exactly as before.

**Least privilege by design:** the provider requests only `openid profile email`.
We override the default profile step so the app makes **no Microsoft Graph call**
and needs **no Graph permission** — identity comes straight from the ID-token
claims. The Entra `sub`/`oid` is never used as the app identity; the local
`app_users.id` is (via `token.uid`), so authorization can't be spoofed by a token.

**Requires HTTPS** in production (so the session cookie is `Secure`) — available
via the nginx `proxy` profile in [DEPLOY.md](DEPLOY.md).

**Config:**
```ini
AUTH_MICROSOFT_ENTRA_ID_ID=<application-client-id>
AUTH_MICROSOFT_ENTRA_ID_SECRET=<client-secret-value>
# Pin to the tenant (omit → multi-tenant "common"; the app_users gate still
# blocks strangers, but pin it in production):
AUTH_MICROSOFT_ENTRA_ID_ISSUER=https://login.microsoftonline.com/<tenant-id>/v2.0
```

---

## 5. Setup runbook (Entra ID)

**In the Microsoft Entra admin center** (or Azure Portal → Entra ID):

1. **App registrations → New registration.**
   - Name: e.g. *QMS Analytics Dashboard*.
   - Supported account types: *Accounts in this organizational directory only*
     (single tenant) for a bank.
   - Redirect URI → platform **Web**:
     `https://<your-domain>/api/auth/callback/microsoft-entra-id`
     (for local testing you may also add `http://localhost:3000/api/auth/callback/microsoft-entra-id`).
2. From the app's **Overview**, copy **Application (client) ID** and
   **Directory (tenant) ID**.
3. **Certificates & secrets → New client secret.** Copy the secret **Value**
   (not the Secret ID) immediately — it's shown only once.
4. **API permissions**: the defaults (`User.Read` / delegated `openid profile
   email`) are enough; no admin consent for Graph is required because the app
   requests only `openid profile email`.
5. Put the three values in `.env` (see [.env.example](.env.example)):
   ```ini
   AUTH_MICROSOFT_ENTRA_ID_ID=<client id>
   AUTH_MICROSOFT_ENTRA_ID_SECRET=<secret value>
   AUTH_MICROSOFT_ENTRA_ID_ISSUER=https://login.microsoftonline.com/<tenant id>/v2.0
   ```
6. Rebuild/restart the app. The **Sign in with Microsoft** button now appears.

**Provisioning users:** for each staff member, add an app user in **User
Management** whose **email matches their Microsoft sign-in address (UPN)**, and
set their role + branches there. Membership in an Entra/AD group grants nothing on
its own — provisioning is explicit and audited (deliberate, for a bank).

**Testing on your PC before the bank hands you a tenant:** create a **free
Microsoft Entra tenant** (Microsoft 365 Developer Program, or a free Azure
account → Entra ID), register the app with the `localhost` redirect URI above,
add a test user in that tenant, then add a matching app user in User Management
with the same email. Run the app over `http://localhost:3000` and click **Sign in
with Microsoft** — you'll get the real "click → Microsoft → back in" flow.

**Break-glass:** keep at least one **local-password super admin** (the account
created at `/setup`). If the tenant, secret, or network to Microsoft is ever
unavailable, that account still signs in via email + password.

---

## 6. Alternative: SAML 2.0

The older enterprise standard; still common with **ADFS** and some banks. Auth.js
core has no built-in SAML, so it needs an add-on — either a SAML library
(`@node-saml/node-saml`, `samlify`) or a **SAML→OIDC bridge** such as BoxyHQ SAML
Jackson (then we consume it as plain OIDC, keeping our code simple). Choose this
only if the client's IdP is SAML-only.

### Not recommended here: Kerberos / Integrated Windows Auth

True "zero-click" SSO on domain-joined Windows machines (SPNEGO negotiation at
the reverse proxy). It's brittle behind Docker/nginx and heavy to operate for the
benefit; OIDC gives ~the same UX for M365 users without the fragility.

---

## 7. Recommendation

- Keep **local passwords** as the zero-dependency default and break-glass.
- Keep **LDAP** for clients who want directory-backed auth without federation.
- Offer **OIDC (Entra ID)** as the "proper SSO" option — now built — when a
  client asks for single sign-on or forbids the app from handling AD passwords.
  Same pluggable pattern; the client selects the tier by configuration alone.

Because the authorization layer is fixed and local, moving a client from
passwords → LDAP → SSO is an operational change, not a re-architecture, and the
data-security guarantees never change.

---

*Related:* [DEPLOY-LDAP.md](DEPLOY-LDAP.md) (LDAP/AD setup + infosec checklist) ·
[DEPLOY.md](DEPLOY.md) (domain + HTTPS, required for SSO) ·
[lib/auth.ts](lib/auth.ts) (the pluggable provider layer).
