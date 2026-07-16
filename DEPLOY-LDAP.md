# LDAP / Active Directory sign-in — deployment & security guide

For banks (and any client) that want staff to log in with their existing
**directory** account instead of a password managed inside this app. This guide
is written to be handed to the bank's **IT / infosec team** — it covers exactly
what to request from them, what to configure, the TLS posture, and how to verify.

> **LDAP is not SSO.** With LDAP the user still types their AD password into our
> login form. For the difference, the authentication architecture, and the path
> to true single sign-on (OIDC/SAML), see **[AUTH-SSO.md](AUTH-SSO.md)**.

---

## 1. What it does (and what it deliberately does *not* do)

**Identity comes from the directory. Authorization stays in the app.**

- When LDAP is enabled, the password a user types on the login form is verified
  by an **LDAP bind** against the bank's Active Directory / LDAP server. The app
  never stores or sees that password beyond passing it to the directory over the
  encrypted link, and it is never written to disk or logged.
- A person must **still exist in the app's User Management**. That local record
  is the sole source of their **role** (Super Admin / Admin / Branch Ops) and
  their **branch access**. Row-level security is enforced from that record on
  every query — LDAP changes *nothing* about authorization.
- So enabling LDAP swaps out one thing only: *"how is the password checked."*
  Everything else — RBAC, branch-scoped data, the hash-chained audit log,
  account lockout — is unchanged. **No database migration is required.**

```
   login form  ──password──►  app  ──LDAP bind over TLS──►  Active Directory
        │                       │                                  │
        │                       └── looks up role + branches ◄── app_users (local)
        │                                   (authorization)
        └── user types their normal AD username/email + AD password
```

**Why this design passes a security review:** the directory remains the single
source of truth for credentials (IT can disable an account in AD and the person
loses dashboard access immediately), while the application keeps least-privilege
authorization locally so a directory compromise still can't hand someone Admin
rights or another branch's data.

---

## 2. What to request from the bank's AD / infosec team

Give them this list. You need most of it only for **search mode** (recommended
for AD); simple mode needs far less.

| Item | Example | Needed for |
|---|---|---|
| LDAPS URL (host + 636) | `ldaps://dc1.bank.local:636` | both |
| The directory's **CA certificate** (PEM) | issuing CA of the DC cert | both (TLS) |
| A **read-only service account** DN + password | `CN=svc-qms,OU=Service Accounts,DC=bank,DC=local` | search mode |
| **Search base** (where user accounts live) | `DC=bank,DC=local` | search mode |
| Which **attribute** users log in with | `sAMAccountName`, `userPrincipalName`, or `mail` | search mode |
| UPN suffix (if using simple mode) | `@bank.local` | simple mode |

Two security asks to make explicit to their team:

1. **The service account must be read-only** — it only searches for a user's DN.
   No write, no reset, no privileged group membership.
2. **Give us the CA cert, not "just turn off verification."** We verify the
   directory's certificate; an unverified LDAP link can be silently
   man-in-the-middled to harvest passwords.

---

## 3. Configure it

All settings live in `.env` (see the commented **LDAP / Active Directory** block
in [.env.example](.env.example)). Leaving `LDAP_URL` unset keeps the built-in
local passwords — LDAP is entirely opt-in.

### Option A — Search mode (recommended for Active Directory)

A read-only service account finds the user, then the app re-binds *as that user*
to check the password. Handles users in nested OUs and lets people log in with
either their username or email.

```ini
LDAP_URL=ldaps://dc1.bank.local:636
LDAP_BIND_MODE=search
LDAP_BIND_DN=CN=svc-qms,OU=Service Accounts,DC=bank,DC=local
LDAP_BIND_PASSWORD=the-service-account-password
LDAP_SEARCH_BASE=DC=bank,DC=local
LDAP_SEARCH_FILTER=(|(sAMAccountName={login})(mail={login}))
LDAP_TLS_CA="-----BEGIN CERTIFICATE-----\n...(the DC's issuing CA)...\n-----END CERTIFICATE-----"
```

`{login}` is substituted with whatever the user typed on the login form (their
app email). The value is RFC-4515 escaped before it enters the filter, so it
can't be used for LDAP injection.

### Option B — Simple mode (smaller directories / fixed UPN)

Bind directly as the user with no service account. Works when the login name
maps cleanly to a bind DN or UPN.

```ini
LDAP_URL=ldaps://dc1.bank.local:636
LDAP_BIND_MODE=simple
LDAP_BIND_DN_TEMPLATE={login}@bank.local
# or a full DN template:
# LDAP_BIND_DN_TEMPLATE=uid={login},ou=people,dc=bank,dc=local
LDAP_TLS_CA="-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"
```

### Matching app users to directory users

The join key is the **email** on the app account. When you create a user in
User Management, set their email to the value your search filter matches (their
AD `mail`, or their UPN if that's what you filter on). Their AD password field
in the app is ignored while LDAP is on — AD owns it.

---

## 4. TLS & the transport (infosec)

**Always encrypt the bind.** A plain LDAP bind sends the password in cleartext.
Two supported ways to encrypt:

- **LDAPS (preferred):** `LDAP_URL=ldaps://...:636` — TLS from the first byte.
- **StartTLS:** `LDAP_URL=ldap://...:389` **plus** `LDAP_START_TLS=true` —
  upgrades the plaintext connection to TLS before the bind.

Certificate verification is **on by default** and driven by `LDAP_TLS_CA`:

```ini
LDAP_TLS_CA="-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"
LDAP_TLS_REJECT_UNAUTHORIZED=true   # never set false against a real directory
```

`LDAP_TLS_REJECT_UNAUTHORIZED=false` disables verification and exists **only**
for a throwaway lab. Do not ship it — an unverified link defeats the point of
LDAPS.

Timeouts fail the login **closed** (deny), never open:

```ini
LDAP_TIMEOUT_MS=8000
LDAP_CONNECT_TIMEOUT_MS=5000
```

---

## 5. Break-glass — don't get locked out

If the domain controller is unreachable, *nobody* could log in — including you.
So the **super admin created at `/setup` keeps their local password** as a
break-glass account, even while LDAP is enabled.

```ini
LDAP_LOCAL_ADMIN_FALLBACK=true    # default; the super admin can use its local password
# LDAP_LOCAL_ADMIN_FALLBACK=false # force even the super admin through the directory
```

Infosec guidance for the break-glass account:
- Give it a long, unique passphrase stored in the bank's password vault.
- It is a single, named account — not a shared one — and every use is in the
  audit log.
- If your policy requires *all* auth via AD, set the flag to `false` and instead
  keep a documented recovery procedure (e.g. temporarily unset `LDAP_URL` and
  restart) for a DC outage.

---

## 6. Verify before going live

**a. Test the directory link from the server** (proves URL + TLS + service
account, independent of the app). With `ldap-utils` installed:

```bash
# Search mode — does the service account bind, and can it find a user?
LDAPTLS_CACERT=/path/to/ca.pem ldapsearch -H ldaps://dc1.bank.local:636 \
  -D "CN=svc-qms,OU=Service Accounts,DC=bank,DC=local" -w 'svc-password' \
  -b "DC=bank,DC=local" "(sAMAccountName=jdoe)" dn
```

A single `dn:` line back = URL, TLS, CA, and the service account are all good.

**b. Test a real login end-to-end:**
1. In User Management, create a test user whose **email** matches a real AD
   account, give them a role + branch, and assign a branch.
2. Log out, then sign in as that user with their **AD password**.
3. Confirm the audit log shows `LOGIN_SUCCESS`. A wrong AD password should show
   `LOGIN_FAILURE` with reason `ldap_bad_password`; a DC outage shows
   `ldap_unavailable`.

**c. Confirm break-glass:** the super admin can still sign in with its local
password.

---

## 7. Troubleshooting

| Symptom / audit reason | Likely cause | Fix |
|---|---|---|
| `ldap_unavailable` on every login | DC unreachable, wrong port, TLS/CA mismatch, or service-account bind failed | Run the `ldapsearch` in §6a; check firewall to 636, and that `LDAP_TLS_CA` is the DC's *issuing CA* |
| `ldap_bad_password` for a known-good password | Filter doesn't match the account, or user logs in with a different attribute | Adjust `LDAP_SEARCH_FILTER`; confirm the app email matches the AD attribute |
| Everyone denied except super admin | LDAP misconfig while break-glass masks it for the admin only | Fix the LDAP settings; the admin path is deliberately independent |
| `self signed certificate` / cert errors | CA not provided or wrong chain | Set `LDAP_TLS_CA` to the correct PEM; do **not** disable verification |
| Works in lab, fails in prod | Lab used `LDAP_TLS_REJECT_UNAUTHORIZED=false` | Provide the real CA and remove that flag |

---

## 8. Infosec review checklist

- [ ] Bind is encrypted end-to-end (LDAPS `:636`, or StartTLS) — no cleartext 389 bind.
- [ ] `LDAP_TLS_CA` set; `LDAP_TLS_REJECT_UNAUTHORIZED` is `true` (or unset).
- [ ] Service account is **read-only**, non-privileged, dedicated to this app.
- [ ] `LDAP_BIND_PASSWORD` lives only in `.env` on the server (git-ignored), and
      is rotated per the bank's schedule.
- [ ] Authorization (role + branch) is provisioned in-app per user; disabling an
      account in AD removes access; removing it in-app removes access. Both are
      required — neither alone grants data.
- [ ] Account lockout (`AUTH_MAX_FAILED` / `AUTH_LOCKOUT_MINUTES`) still applies
      locally on top of AD's own policy.
- [ ] Break-glass super-admin password is vaulted; its use is audit-logged.
- [ ] Login successes and failures (incl. `ldap_*` reasons) land in the
      hash-chained audit log.
- [ ] Passwords are never persisted or logged by the app — verified in code
      ([lib/ldap.ts](lib/ldap.ts), [lib/auth.ts](lib/auth.ts)).

---

*Related:* [DEPLOY.md](DEPLOY.md) (domain + HTTPS) · [.env.example](.env.example)
(all settings).
