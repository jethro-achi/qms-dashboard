# Changelog

## 2026-07-16 — Deployment release

Auth, SLA accuracy, dual data-source support, branding, and deployment docs
readied for go-live.

### Added

- **LDAP / Active Directory authentication** ([lib/ldap.ts](lib/ldap.ts),
  wired in [lib/auth.ts](lib/auth.ts)). Password verification can now be done by
  an LDAP bind instead of local passwords, via `LDAP_*` env vars. Supports both
  **simple bind** (bind directly as the user) and **search bind** (read-only
  service account finds the DN, then re-binds as the user — the AD standard).
  Authorization (role + branch) stays in the app. A break-glass local super-admin
  password survives a down domain controller. TLS-verified; passwords never
  stored or logged.
- **QMS data-source modes (old / new)** ([lib/analytics/source.ts](lib/analytics/source.ts),
  [lib/db.ts](lib/db.ts)). A super-admin radio in Settings → *QMS data source*
  chooses the ticket layout: **old** = classic `banktickets` table; **new** =
  live values merged from `counters.tickets` JSON (via `JSON_TABLE`, deduped by
  latest serving occurrence) over `banktickets`, with names resolved from
  `sub_menu_items`. Mode-aware DB pools; every analytics/report query threaded to
  honour the active mode; env default `QMS_SOURCE_MODE`.
- **"Powered by OcTech" branding footer** ([components/powered-by.tsx](components/powered-by.tsx))
  on all signed-in pages and the login screen. Self-contained, theme-aware inline
  SVG (blue wordmark + green squares fixed; "COUNTLESS POSSIBILITIES" tagline
  flips white↔dark with the theme). Non-clickable, non-selectable, non-draggable.
- **Deployment docs**: [SETUP.md](SETUP.md) (deployment-day auth + TLS guide:
  LDAP vs SSO decision, exact bind config, and CSR → signed-cert flow),
  [AUTH-SSO.md](AUTH-SSO.md) (SSO/OIDC roadmap — not yet wired), plus LDAP infosec
  notes in [DEPLOY-LDAP.md](DEPLOY-LDAP.md).

### Changed

- **On-premises AI assistant deactivated by default** (plug-and-play, nothing
  removed). New `ASSISTANT_ENABLED` switch ([lib/ai/enabled.ts](lib/ai/enabled.ts))
  defaults to `false`: the "brain" launcher is hidden **and** `/api/assistant`
  returns 404 (fail-closed server-side, not just a hidden button). The Ollama
  model runtime now sits behind a Compose profile, so it no longer starts or
  consumes CPU/RAM. To re-enable when compute allows: set `ASSISTANT_ENABLED=true`,
  `docker compose --profile assistant up -d`, then pull the model once.
- **"Default to today's data" now hides the per-user toggle.** When the super
  admin turns the setting on, every dashboard/report is scoped to today for
  everyone and the "Show today's data" button is hidden (a date range in the
  filter bar remains the way to view history). The app-wide default now wins
  outright rather than acting as a fallback — otherwise a stale `today: false`
  in a user's cookie would strand them on history with the button gone. With the
  setting off, the button returns and each user's choice persists as before
  ([lib/analytics/filters.ts](lib/analytics/filters.ts)).
- **SLA is now a two-threshold model.** A ticket meets SLA only when **both** the
  wait time **and** the service time are within target (defaults: wait ≤ 10 min,
  service ≤ 5 min), configurable in Settings → *Metrics & Thresholds*
  (`QMS_SLA_WAIT_SECONDS` / `QMS_SLA_SERVICE_SECONDS` defaults). Exceptions =
  wait **or** service over the anomaly threshold (default 60 min). Applied
  consistently across KPIs, staff productivity, exceptions, branch reports, and
  the help/glossary copy.
- **KPI trends now distinguish "no data" from "steady."** When a comparison
  window has no trustworthy baseline, cards read **"No prior-period data"**
  (muted, no arrow) instead of a misleading "steady," while the deltas still show
  `—` ([lib/analytics/home.ts](lib/analytics/home.ts),
  [components/analytics/kpi-cards.tsx](components/analytics/kpi-cards.tsx)).
- **Brand logos are no longer clickable.** The sidebar logo is no longer a link
  to `/dashboard`; sidebar and login logos are non-selectable/non-draggable
  ([components/app-sidebar.tsx](components/app-sidebar.tsx),
  [app/(auth)/login/login-form.tsx](app/(auth)/login/login-form.tsx)).
- **nginx**: `server_name` set to a placeholder FQDN `qms.bank.local` (both
  server blocks) to match the CSR default in SETUP.md
  ([deploy/nginx/qms-dashboard.conf](deploy/nginx/qms-dashboard.conf)).
- **.env.example** documents the new `LDAP_*`, SLA (`QMS_SLA_*` / `QMS_ANOMALY_SECONDS`),
  and QMS source (`QMS_SOURCE_MODE`, `QMS_NEW_DB_*`) settings.

### Security

Remediates two findings from a security scan.

- **Unix timestamp disclosure (public, pre-auth).** `logoVersion()` emitted the
  logo file's raw mtime, rendered into the anonymous login page as
  `/api/branding/logo?v=1867154220`. The value was `mtimeMs | 0` — the low 32
  bits of the modification time, i.e. the mtime modulo ~49.7 days — so repeated
  sampling could reveal when server-side config changed and leak server clock
  information. It is now an opaque SHA-256 of mtime+size (`?v=6c8e1696cc6f`),
  which preserves cache-busting while disclosing nothing
  ([lib/branding.ts](lib/branding.ts)). The same `Date.now()` leak was removed
  from the admin logo preview. Audited the rest of the codebase: all other
  epoch values are internal-only (cache TTLs, availability arithmetic) or are
  authenticated business timestamps.
- **CSP coverage gaps.** The nonce-based policy in [middleware.ts](middleware.ts)
  was already strict, but its matcher skips Next's static assets, so
  `/_next/static/*` and `/_next/image` shipped **no CSP at all**, and nginx's
  HTTP→HTTPS redirect (generated by nginx, never touching the app) had none
  either. Both now send a locked-down `default-src 'none'; …; sandbox` policy,
  scoped so it can never collide with the nonce policy on real documents (two
  CSP headers intersect, which would break every script on the page).
- **Duplicate/contradictory security headers removed from nginx.** nginx was
  appending `X-Frame-Options: SAMEORIGIN` while the app sends `DENY`, and a
  weaker HSTS (1y) alongside the app's 2y + `includeSubDomains; preload`. The app
  ([next.config.mjs](next.config.mjs) + middleware) is now the single source of
  truth ([deploy/nginx/qms-dashboard.conf](deploy/nginx/qms-dashboard.conf)).

### Fixed

- Settings default-mode selector showed a stray lowercase "dark" alongside "Dark".
- QMS data-source radio referenced a missing `desc` field (typecheck break) and a
  "New (New)" title typo ([components/admin/theme-settings.tsx](components/admin/theme-settings.tsx)).
- New-mode "Illegal mix of collations" error when reading the merged JSON relation —
  JSON columns are now pinned to the QMS tables' collation
  (`QMS_NEW_DB_COLLATION`, default `utf8mb4_0900_ai_ci`).
