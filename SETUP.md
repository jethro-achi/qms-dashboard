# QMS Dashboard — Deployment-Day Setup (Auth + TLS)

A short, do-this-in-order guide for go-live. Covers **which login method to use
(LDAP vs SSO)**, **exactly what binds to what**, and **generating a CSR** for the
product's TLS certificate.

For deeper reference: [DEPLOY-LDAP.md](DEPLOY-LDAP.md) (full LDAP options),
[AUTH-SSO.md](AUTH-SSO.md) (SSO roadmap), [DEPLOY.md](DEPLOY.md) (containers/proxy).

---

## 0. The one thing to understand first

The dashboard separates **who you are** from **what you can see**:

- **Authentication** (proving identity / password check) can be done **locally**
  (built-in Argon2 passwords) **or by your directory over LDAP**.
- **Authorization** (role + which branches) **always lives in the app**, under
  **Admin → User Management**. The directory never controls roles.

So for *every* method below, **each user must still exist in the app** with a role
(SUPER_ADMIN / ADMIN / BRANCH_OPS) and branch assignment. LDAP only replaces the
password check.

---

## 1. Choose the login method

| Method | Status | Use when | How to turn on |
|---|---|---|---|
| **Local passwords** | ✅ Built-in, zero config | Small deployment, no directory, or POC | Do nothing — it's the default |
| **LDAP / Active Directory** | ✅ Implemented | Bank/enterprise wants domain credentials | Set `LDAP_URL` + bind vars (Section 2) |
| **SSO (OIDC / SAML)** | ⏳ **Not wired yet** | Org mandates Entra ID / Okta / Ping SSO | **Requires a code change — cannot be enabled by config for tomorrow.** See Section 4 |

> **For tomorrow: use LDAP** if the client has AD, otherwise local passwords.
> SSO is a follow-up (a provider must be added in code first).

---

## 2. LDAP / Active Directory setup

Put these in `.env.local` (never commit it). Setting `LDAP_URL` is what switches
password verification from local Argon2 to an LDAP **bind**.

### 2a. Connection + TLS

```dotenv
# Use ldaps:// (TLS on 636). Only use ldap:// (389) if you then StartTLS.
LDAP_URL=ldaps://dc1.bank.local:636

# Paste the DIRECTORY's issuing CA certificate (PEM) so we can verify the DC.
# This is the DC's CA — NOT a CSR you generate. Never disable verification in prod.
LDAP_TLS_CA="-----BEGIN CERTIFICATE-----
...DC issuing CA...
-----END CERTIFICATE-----"
LDAP_TLS_REJECT_UNAUTHORIZED=true      # keep true in production
# LDAP_START_TLS=true                  # only if you used ldap:// above and upgrade to TLS

# Break-glass: the super admin from /setup keeps their LOCAL password so a down
# domain controller can never lock you out. Set false to force even them via LDAP.
LDAP_LOCAL_ADMIN_FALLBACK=true
```

### 2b. Pick ONE bind style — "what binds to what"

**Simple bind** — the app binds **directly as the user** with the password they
typed. Best when the login they type equals their UPN/email.

```dotenv
LDAP_BIND_MODE=simple
# {login} = exactly what the user types in the form (their app email).
LDAP_BIND_DN_TEMPLATE={login}@bank.local
#   e.g. jdoe@bank.local  →  bind DN "jdoe@bank.local" with their password.
# Or an explicit DN pattern:
# LDAP_BIND_DN_TEMPLATE=uid={login},ou=people,dc=bank,dc=local
```

Flow: **user's typed password → bind as `{login}` template → success = authenticated.**

**Search bind** — the AD standard. A **read-only service account** first finds the
user's real DN, then the app **re-binds as that DN** with the typed password.

```dotenv
LDAP_BIND_MODE=search
# 1) Service account the app binds as FIRST (read-only, just to search):
LDAP_BIND_DN=CN=svc-qms,OU=Service Accounts,DC=bank,DC=local
LDAP_BIND_PASSWORD=the-service-account-password
# 2) Where and how to find the user. {login} is the typed value, safely escaped.
LDAP_SEARCH_BASE=DC=bank,DC=local
LDAP_SEARCH_FILTER=(|(sAMAccountName={login})(mail={login}))
```

Flow: **bind as `svc-qms` → search under base for `{login}` → get user DN →
re-bind as that DN with the user's typed password → success = authenticated.**

> Bind order recap: **service account binds to the directory**, the **user's DN
> binds with the user's password**. The service account only needs *read* rights.

### 2c. Timeouts (optional)

```dotenv
LDAP_CONNECT_TIMEOUT_MS=5000
LDAP_TIMEOUT_MS=8000
```

### 2d. Test it (before users arrive)

1. Create a test user in **Admin → User Management** whose email matches a real
   directory account (same address the directory knows).
2. Sign in with that user's **directory password**. Success = LDAP is binding.
3. Sign in as the super admin with their **local** password — confirms break-glass
   still works even if the DC is unreachable.
4. Wrong password must fail; a stopped DC must fall back to break-glass only.

**Security:** the service account is read-only; passwords are never stored or
logged; TLS verification stays on. See [DEPLOY-LDAP.md](DEPLOY-LDAP.md) for the
infosec write-up.

---

## 3. Product TLS certificate — generate a CSR

The app is served over HTTPS by the bundled **nginx reverse proxy**, which
terminates TLS. Nginx expects the signed cert + key here **with these exact names**:

```
deploy/nginx/certs/qms-dashboard.crt   # full chain: server cert + intermediate(s)
deploy/nginx/certs/qms-dashboard.key   # private key   (git-ignored — never commit)
```

### 3a. Generate the CSR + private key (openssl)

Run on the deployment host (or any box with openssl). Replace the FQDN with the
name users will browse to.

```bash
openssl req -new -newkey rsa:2048 -nodes \
  -keyout qms-dashboard.key \
  -out    qms-dashboard.csr \
  -subj   "/C=UG/ST=Kampala/L=Kampala/O=Your Bank Ltd/OU=IT/CN=qms.bank.local" \
  -addext "subjectAltName=DNS:qms.bank.local"
```

- `CN` and the `DNS:` SAN **must** be the exact hostname in the browser URL
  (modern browsers require the SAN).
- Add more SANs if needed: `subjectAltName=DNS:qms.bank.local,DNS:qms`.

### 3b. Get it signed

Send **`qms-dashboard.csr`** to your CA (the bank's internal PKI team, or a public
CA). They return a signed certificate, usually plus one or more intermediate certs.
Keep **`qms-dashboard.key`** private — never send it anywhere.

### 3c. Assemble and install

Build the full chain (server cert first, then intermediates) and drop both files in:

```bash
cat server.crt intermediate.crt > qms-dashboard.crt   # order matters
cp qms-dashboard.crt qms-dashboard.key deploy/nginx/certs/
```

Then set the hostname in [deploy/nginx/qms-dashboard.conf](deploy/nginx/qms-dashboard.conf)
(`server_name` is `QMS-DASHBOARD` by default — change it to `qms.bank.local`) and
restart the proxy:

```bash
docker compose restart proxy
```

### 3d. Quick self-signed cert (POC/demo only — not for the bank)

```bash
openssl req -x509 -newkey rsa:2048 -nodes -days 365 \
  -keyout deploy/nginx/certs/qms-dashboard.key \
  -out    deploy/nginx/certs/qms-dashboard.crt \
  -subj   "/CN=qms.bank.local" -addext "subjectAltName=DNS:qms.bank.local"
```

Browsers will warn (untrusted) — fine for a demo, never for production.

---

## 4. SSO (Entra ID / Okta / Ping) — not enabled by config

There is **no OIDC/SAML provider wired in yet** — the app currently authenticates
via the Credentials provider only. SSO therefore **cannot be switched on with env
vars for tomorrow**; it needs a small code addition (add an OIDC provider to the
Auth.js config, keeping roles/branches in the app as today).

If SSO is a hard requirement, ship tomorrow on **LDAP or local passwords**, and
follow [AUTH-SSO.md](AUTH-SSO.md) as the roadmap to add it next. The design keeps
authorization local, so adding SSO won't disturb roles/branch access.

---

## 5. Other TLS/CA touchpoints (don't confuse with 3)

These are **CA certs you paste to verify a server**, not CSRs you generate:

- **`LDAP_TLS_CA`** — the directory (DC) server's issuing CA. Lets us verify LDAPS.
- **`QMS_DB_CA`** — the QMS database server's CA, to force verified TLS to the DB.

Only Section 3 (the product's own cert) involves generating a CSR.

---

## Go-live checklist

- [ ] App users created with correct role + branch (Admin → User Management)
- [ ] Login method chosen: **LDAP** (Section 2) or local passwords
- [ ] If LDAP: `LDAP_URL` + bind vars set, `LDAP_TLS_CA` pasted, break-glass tested
- [ ] Product cert: CSR signed, `qms-dashboard.crt`/`.key` in `deploy/nginx/certs/`
- [ ] `server_name` set to the real FQDN; `docker compose restart proxy`
- [ ] `QMS_DB_CA` set if the DB link isn't on a trusted private segment
- [ ] Secrets (`AUTH_SECRET`, `CRON_SECRET`, DB/LDAP passwords) are env-only, uncommitted
