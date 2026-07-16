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
| **SSO (OIDC / SAML)** | User authenticates at the corporate Identity Provider; app never sees the password; click-through if already signed in | ❌ **Not yet** — the architecture is ready for it (§4) |

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

## 4. The path to true SSO

### Recommended: OIDC (OpenID Connect)

Best fit for any client on **Microsoft 365 / Entra ID** (Azure AD) — which covers
most banks — and works equally with Okta, Keycloak, Google Workspace, etc.
Auth.js v5 (which this app already uses) supports OIDC providers first-class, so
it drops into the **same provider list** as the existing Credentials/LDAP path.

**How it fits, concretely:**

1. Register the app in the IdP; it issues a **Client ID + secret** and you
   register a redirect URI: `https://QMS-DASHBOARD/api/auth/callback/<provider>`.
2. Add an OIDC provider block in [lib/auth.ts](lib/auth.ts) (e.g.
   `next-auth/providers/microsoft-entra-id`, or a generic OIDC provider with the
   issuer URL).
3. In the sign-in callback, take the verified identity (the IdP's `email` /
   `preferred_username`) and **look it up in `app_users`** to load role +
   branches — the *exact same authorization step* the Credentials path already
   does. No local user record → sign-in denied (fail-closed).
4. Requires HTTPS (already available via the nginx `proxy` profile in
   [DEPLOY.md](DEPLOY.md)) so session cookies are `Secure`.

Net new work is a provider block + a profile→`app_users` mapping. Everything
downstream (RBAC, RLS, audit, break-glass) is reused unchanged.

**Config shape (illustrative — not yet wired):**
```ini
# Entra ID / Azure AD
AUTH_MICROSOFT_ENTRA_ID_ID=<client-id>
AUTH_MICROSOFT_ENTRA_ID_SECRET=<client-secret>
AUTH_MICROSOFT_ENTRA_ID_ISSUER=https://login.microsoftonline.com/<tenant-id>/v2.0
```

### Alternative: SAML 2.0

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

## 5. Recommendation

- Keep **local passwords** as the zero-dependency default.
- Keep **LDAP** for clients who want directory-backed auth without federation.
- Add **OIDC** as the "proper SSO" option when a client asks for single sign-on
  or forbids the app from handling AD passwords. Same pluggable pattern — the
  client selects the tier by configuration alone.

Because the authorization layer is fixed and local, moving a client from
passwords → LDAP → SSO is an operational change, not a re-architecture, and the
data-security guarantees never change.

---

*Related:* [DEPLOY-LDAP.md](DEPLOY-LDAP.md) (LDAP/AD setup + infosec checklist) ·
[DEPLOY.md](DEPLOY.md) (domain + HTTPS, required for SSO) ·
[lib/auth.ts](lib/auth.ts) (the pluggable provider layer).
