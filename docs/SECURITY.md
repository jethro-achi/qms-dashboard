# Security posture — QMS Analytics Dashboard

This document answers the questions a bank information-security review will ask
before this app is allowed onto the network. Every answer points at the code
that enforces it, so claims can be verified rather than trusted.

Threat model in one line: an internal analytics dashboard that reads the bank's
QMS data (read-only) and holds its own users, audit log, and in-app messages,
deployed on the intranet behind the bank's TLS-terminating reverse proxy.

---

## 1. Authentication

**Q: How are users authenticated and passwords stored?**
Self-managed credentials via Auth.js (`lib/auth.ts`). Passwords are hashed with
**Argon2id** (`@node-rs/argon2`, memory-hard, GPU-resistant) — never stored or
logged in plaintext. Hashes live in `app_users.password_hash`.

**Q: Brute-force / credential stuffing?**
Per-account lockout: after `AUTH_MAX_FAILED` (default 5) failures the account is
locked for `AUTH_LOCKOUT_MINUTES` (default 15). Failed and successful sign-ins
are audit-logged. Login errors are deliberately uniform ("check your email and
password") so they don't reveal whether an account exists (`lib/auth.ts`).

**Q: Session management and timeout?**
Stateless JWT sessions (`session.strategy = "jwt"`) with a fixed
`SESSION_MAX_AGE` (default 30 min). Session cookies are HTTP-only and, over
HTTPS, carry the `__Secure-` prefix (Auth.js default). On expiry, server
navigations bounce to `/login`; a client sentinel (`components/session-guard.tsx`)
also detects expiry on an interval / tab-focus and redirects to
`/login?expired=1` so an idle open tab returns to login without a manual refresh.

> Tunable: for an idle (sliding) timeout instead of the absolute one, lower
> Auth.js `updateAge`. The current policy is an absolute 30-minute cap.

---

## 2. Authorization & data segregation

**Q: How do you stop a branch user seeing another branch's data?**
Authorization is enforced in the **query**, never in the UI. Every read of QMS
data passes through `buildWhere()` (`lib/analytics/queries.ts`), which prepends a
parameterised branch filter derived from the signed-in user's session
(`lib/rbac.ts` `branchScope`). A branch-scoped user with zero branches gets an
always-false clause (`1 = 0`) — it **fails closed**. Roles:

| Role | Sees | Admin powers |
|------|------|--------------|
| `SUPER_ADMIN` | all branches | user mgmt, settings, audit |
| `ADMIN` | all branches | none |
| `BRANCH_OPS` | assigned branch(es) only | none |

The middleware cookie check (`middleware.ts`) is a coarse gate only; the real
boundary is `requireUser` / `requireSuperAdmin` and `buildWhere` on the server in
every route and page. Covered by `tests/rbac.test.ts` and `tests/build-where.test.ts`.

**Q: Can the app modify the bank's QMS data?**
No. The QMS pool (`lib/db.ts`) connects with a DB user that must be granted
**SELECT only** on the QMS tables, and the driver runs with
`multipleStatements: false`. Read-only is enforced at the grant level, so the app
physically cannot mutate queue data.

---

## 3. Input validation & injection defence

**Q: SQL injection?**
All SQL uses **bound parameters** (`?` placeholders) — client input is never
concatenated into SQL. The few identifiers that can't be bound (sort/group-by
columns) are checked against an allow-list (`SORTABLE_COLUMNS`,
`assertSortColumn` in `lib/db.ts`). Date windows computed server-side are the only
inlined literals, and they're derived numerically, not from user text. Verified
in `tests/build-where.test.ts` (injection payloads land in `params`, never the SQL).

**Q: Are API inputs validated?**
Every mutating API route validates its body with **Zod** before use (users,
settings, reports, exports, messages…), e.g. `app/api/admin/users/route.ts`,
`app/api/export/visual/route.ts`. Cookie-borne filters are validated and
fail-closed in `parseFilters` (`tests/filters.test.ts`); unknown keys are stripped.

**Q: CSV / spreadsheet formula injection?**
Exported CSV cells are encoded through one hardened function (`lib/csv.ts`): RFC-
4180 quoting **plus** neutralising leading `= + - @ \t \r` with a `'` so a value
like `=cmd|'/c calc'!A1` can't execute when opened in Excel (OWASP CSV Injection).
Used by report and audit exports; covered in `tests/csv.test.ts`. Excel exports
use exceljs string cells (not formulas).

---

## 4. Encryption in transit

**Q: Is traffic encrypted end to end?**
- **Browser ⇄ app:** served over HTTPS terminated at the bank's reverse proxy.
  The app emits **HSTS** (`Strict-Transport-Security`, 2 years, `includeSubDomains`,
  `preload`) in `next.config.mjs`, and Auth.js issues `__Secure-` cookies over
  HTTPS. TLS must be provisioned at deploy time (see the checklist).
- **App ⇄ QMS DB:** TLS supported via `QMS_DB_CA` — point it at the DB server's CA
  and the driver verifies with `rejectUnauthorized: true` (`lib/db.ts`). Do **not**
  disable verification.
- **App ⇄ application DB:** the adapters honour a TLS flag — MySQL
  (`rejectUnauthorized: true`) and SQL Server (`encrypt: true`) when `ssl` is set
  in the setup config (`lib/db-adapters/*`).

Message bodies and attachments travel over the same HTTPS channel; attachments
stream through authenticated routes only (below).

---

## 5. Content security, XSS & clickjacking

**Q: XSS controls / CSP?**
A per-request **nonce-based CSP** with `strict-dynamic` (`middleware.ts`): in
production there is **no `unsafe-inline` / `unsafe-eval` for scripts**. `img/font`
are limited to `self` + `data:`, `connect-src 'self'`, `object-src 'none'`,
`base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`. Plus
`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, and a locked-down
`Permissions-Policy` (`next.config.mjs`). React escapes rendered values by default;
there is no `dangerouslySetInnerHTML` on user content.

**Q: Stored XSS via uploaded files (SVG/HTML)?**
User-supplied files (message attachments, the client logo) are served with
`X-Content-Type-Options: nosniff` and a sandboxing response CSP
(`default-src 'none'; sandbox`), and **SVG is forced to download** rather than
render as a top-level document (`app/api/messages/attachment/[id]/route.ts`,
`app/api/branding/logo/route.ts`). Uploads are limited to a MIME allow-list and
10 MB (`lib/message-attachments.ts`, `tests/message-attachments.test.ts`).

---

## 6. File handling

**Q: Path traversal / unauthorised file access?**
Stored files use opaque server-generated UUID keys; read paths reject any key
containing `/`, `\`, or `..` (`lib/message-attachments.ts`,
`lib/reports/storage.ts`). Downloads are authorised by the **owning DB row**, not
by guessing a key — a message attachment can only be fetched by a party to that
message (`getMessageAttachment`), and a stored report only by its owner. Verified
end-to-end previously (a non-owner id returns 404).

---

## 7. Auditability & non-repudiation

**Q: Can you prove who did what, and that the record wasn't altered?**
`app_audit_log` is an **append-only, SHA-256 hash-chained** trail
(`lib/audit.ts`): each row hashes `(previous hash + canonical(this row))`, so
editing or deleting any historical row breaks every hash after it, detectable via
`verifyChain()`. Administrative actions (user create/update/delete, password
resets, settings changes, report schedules) and auth events are recorded with
actor, IP and user-agent. The super-admin-only viewer (`/admin/audit`) shows the
integrity status and exports CSV. Determinism of the canonicaliser (the property
the chain relies on) is pinned in `tests/audit-canonical.test.ts`.

---

## 8. Secrets & configuration

- `AUTH_SECRET` (JWT signing) and `CRON_SECRET` (scheduled-report trigger) are
  environment-only and never committed; `.env.example` ships placeholders.
- The scheduled-report endpoint fails **closed** if `CRON_SECRET` is unset and
  compares keys with `timingSafeEqual` (`app/api/reports/run-due/route.ts`).
- Application DB credentials are entered once via the first-run `/setup` wizard
  and stored under `APP_CONFIG_DIR` (mount as a protected volume), not in code.

---

## 9. Intranet / restricted-network fit

- **No third-party network calls at runtime.** CSP is `connect-src 'self'`; there
  are no CDN scripts, external fonts, or remote images (fonts/images are `self` or
  `data:`). The app runs fully air-gapped.
- Ships as a small self-contained **standalone** build for an on-prem container
  image (`next.config.mjs`).
- `trustHost` is enabled for deployment behind the bank's reverse proxy; set the
  canonical `AUTH_URL`/host at deploy time.

---

## 10. Testing & engineering assurance

Security-critical, pure logic is unit-tested with **Vitest** (`npm test`):
RBAC/RLS scoping, `buildWhere` parameterisation, input sanitisation, CSV
formula-injection defence, audit canonicalisation, KPI trend rules, period/schedule
math, and the attachment allow-list + traversal guard. TypeScript is compiled with
`tsc --noEmit` in CI-style checks before every change.

---

## Deployment hardening checklist

- [ ] Terminate TLS at the reverse proxy; redirect HTTP→HTTPS (HSTS is already sent).
- [ ] Grant the QMS DB user **SELECT-only** on the QMS tables; set `QMS_DB_CA`.
- [ ] Set `ssl: true` for the application DB and provide its CA.
- [ ] Generate strong `AUTH_SECRET` and `CRON_SECRET` (`openssl rand`).
- [ ] Mount `APP_CONFIG_DIR` as a persistent, access-controlled volume.
- [ ] Confirm `NODE_ENV=production` (enables the strict script CSP).
- [ ] Restrict the reverse proxy to the intranet; allow-list the cron caller for
      `/api/reports/run-due`.
- [ ] Set session policy (`SESSION_MAX_AGE`, lockout thresholds) to bank standard.
- [ ] Forward container logs (incl. `AUDIT_WRITE_FAILED`) to the SIEM.
