# Deployment guide

How to deploy the QMS Analytics Dashboard to production. The target is a
**container on the bank intranet** (Docker on a VM, Compose, or Kubernetes) —
not a public serverless platform (see [Why not Vercel](#why-not-vercel)).

- [1. Prerequisites](#1-prerequisites)
- [2. Deployment options](#2-deployment-options)
- [3. Option A — Docker Compose (recommended)](#3-option-a--docker-compose-recommended)
- [4. Option B — standalone container + external DBs](#4-option-b--standalone-container--external-dbs)
- [5. First-run configuration (/setup)](#5-first-run-configuration-setup)
- [6. QMS data (the read side)](#6-qms-data-the-read-side)
- [7. TLS & reverse proxy](#7-tls--reverse-proxy)
- [8. Scheduled reports (cron)](#8-scheduled-reports-cron)
- [9. Production hardening checklist](#9-production-hardening-checklist)
- [10. Backups & restore](#10-backups--restore)
- [11. Upgrades](#11-upgrades)
- [12. Observability](#12-observability)
- [13. Why not Vercel](#13-why-not-vercel)
- [14. Troubleshooting](#14-troubleshooting)

---

## 1. Prerequisites

- A Linux host with **Docker** + the **Compose plugin** (`docker compose
  version`).
- Network reachability from the host to:
  - your **application database** (MySQL or SQL Server) — or use the bundled one,
  - the bank's **QMS read-only replica**.
- A DNS name and a **TLS certificate** for the reverse proxy.
- Secrets ready: `AUTH_SECRET`, `CRON_SECRET`, DB passwords.

Generate secrets:

```bash
openssl rand -base64 32   # AUTH_SECRET
openssl rand -hex 32      # CRON_SECRET
```

---

## 2. Deployment options

| Option | When to use |
| --- | --- |
| **A — Docker Compose** | Evaluation, or a self-contained single-host production deployment. Brings up app + MySQL together. |
| **B — Standalone container** | You already run managed MySQL/SQL Server (and a QMS replica). Run only the app container and point it at them. |

Both use the same image built from the repo `Dockerfile`.

---

## 3. Option A — Docker Compose (recommended)

```bash
git clone https://github.com/<your-org>/qms-dashboard.git
cd qms-dashboard
cp .env.example .env
```

Edit `.env` and set at least:

```dotenv
AUTH_SECRET=<openssl rand -base64 32>
CRON_SECRET=<openssl rand -hex 32>

# Bundled MySQL (Compose provisions these)
MYSQL_ROOT_PASSWORD=<strong>
APP_DB_NAME=appdb
APP_DB_USER=app_user
APP_DB_PASSWORD=<strong>

# QMS (read) side — point at the bundled db, or your replica
QMS_DB_HOST=db
QMS_DB_PORT=3306
QMS_DB_USER=qms_user
QMS_DB_PASSWORD=<matches deploy/mysql-init/01-init.sql, or your replica>
QMS_DB_NAME=qms
# QMS_DB_CA="-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"
```

Bring it up:

```bash
docker compose up -d --build
docker compose ps                 # both services healthy
docker compose logs -f app        # follow startup
```

Then complete [first-run configuration](#5-first-run-configuration-setup).

> **If you use the bundled MySQL for the QMS side too,** change the default
> password in `deploy/mysql-init/01-init.sql` **before the first `up`** (that
> script only runs once, when the data volume is first created).

---

## 4. Option B — standalone container + external DBs

Build and push the image:

```bash
docker build -t registry.internal/qms-dashboard:1.0.0 .
docker push registry.internal/qms-dashboard:1.0.0
```

Run it, pointing at your existing databases and a persistent volume:

```bash
docker run -d --name qms-dashboard \
  --restart unless-stopped \
  -p 3000:3000 \
  -e AUTH_SECRET="$AUTH_SECRET" \
  -e CRON_SECRET="$CRON_SECRET" \
  -e QMS_DB_HOST=qms-replica.internal \
  -e QMS_DB_PORT=3306 \
  -e QMS_DB_USER=qms_user \
  -e QMS_DB_PASSWORD="$QMS_DB_PASSWORD" \
  -e QMS_DB_NAME=qms \
  -e QMS_DB_CA="$QMS_DB_CA" \
  -e APP_CONFIG_DIR=/var/lib/qms-dashboard \
  -v qms_data:/var/lib/qms-dashboard \
  registry.internal/qms-dashboard:1.0.0
```

The application database is **not** configured here — you set it in the `/setup`
wizard, which writes it to the volume.

---

## 5. First-run configuration (/setup)

On first visit the app has no application database configured, so it redirects to
**`/setup`**. This is a one-time wizard:

1. **Engine + connection.** Pick MySQL or SQL Server and enter host, port, user,
   password, database. The wizard tests the connection before continuing.
   - Compose bundled DB: `host=db, port=3306, user=app_user,
     password=<APP_DB_PASSWORD>, database=appdb`.
2. **Create tables.** It runs the idempotent DDL to create the application
   tables (users, branch map, audit log, settings, messages, reports…).
3. **First Super Admin.** Enter the admin's email, name and a **12+ character**
   password. This account sees all branches and creates every other user.
4. **Done.** Credentials are written to `app-config.json` (mode `0600`) on the
   volume. You're redirected to `/login`.

After go-live the wizard **refuses to run again**. To reconfigure deliberately:

```bash
# find the volume mountpoint, remove the config, restart
docker compose exec app sh -c 'rm -f "$APP_CONFIG_DIR/app-config.json"'
docker compose restart app
```

Add more users afterwards from **Admin → User management**, or via the CLI:

```bash
docker compose exec app node scripts/seed-user.mjs \
  "manager@bank.co" "Their Name" "StrongPassw0rd!" BRANCH_OPS "1,2"
```

---

## 6. QMS data (the read side)

The dashboards read from **analytics views** in the `qms` database, defined in
[`db/schema.sql`](../db/schema.sql) (PART A) over the bank's real ticket/branch
tables. In production:

1. Provision the views on the **read-only replica**, adapting the view bodies to
   the real source tables — only the output columns matter to the app.
2. **Lock down the QMS user:** grant `SELECT` on the views only, never on base
   tables:

   ```sql
   CREATE USER 'qms_user'@'%' IDENTIFIED BY '<strong>';
   GRANT SELECT ON qms.v_qms_metrics TO 'qms_user'@'%';
   GRANT SELECT ON qms.v_qms_detail  TO 'qms_user'@'%';
   -- ...one GRANT per view. No base-table grants.
   ```

3. Point `QMS_DB_*` at the replica and set `QMS_DB_CA` to its CA cert to force
   verified TLS.

For evaluation with the bundled MySQL, load a QMS dump into the `qms` database
and ensure the views exist; until then dashboards render but show no data.

---

## 7. TLS & reverse proxy

Terminate TLS at a reverse proxy in front of the container. The app already sets
HSTS and a strict CSP; the proxy just needs to serve HTTPS and forward the host.

Minimal nginx:

```nginx
server {
  listen 443 ssl;
  server_name qms.bank.internal;

  ssl_certificate     /etc/ssl/qms/fullchain.pem;
  ssl_certificate_key /etc/ssl/qms/privkey.pem;

  location / {
    proxy_pass         http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header   Host              $host;
    proxy_set_header   X-Forwarded-Proto https;
    proxy_set_header   X-Forwarded-For   $remote_addr;
    proxy_read_timeout 300s;   # allow report generation
  }

  location /api/health { proxy_pass http://127.0.0.1:3000/api/health; access_log off; }
}
```

`trustHost` is enabled in Auth.js so cookies work behind the proxy. Serve **only**
over HTTPS — the secure-prefixed session cookie requires it.

---

## 8. Scheduled reports (cron)

The app doesn't run its own scheduler; an external trigger POSTs to
`/api/reports/run-due` with the `x-cron-key` header. If `CRON_SECRET` is unset the
endpoint fails closed and no scheduled reports run.

Linux cron (every 10 minutes):

```cron
*/10 * * * * curl -fsS -X POST -H "x-cron-key: <CRON_SECRET>" https://qms.bank.internal/api/reports/run-due
```

Windows Task Scheduler: a task running the same request via
`Invoke-RestMethod -Method Post -Headers @{ 'x-cron-key' = '<CRON_SECRET>' }`.

Point the trigger at a **single** instance if you run more than one (so due
reports aren't generated multiple times).

---

## 9. Production hardening checklist

- [ ] `AUTH_SECRET` and `CRON_SECRET` are strong, unique, and **not** committed.
- [ ] Served only over **HTTPS**; HSTS is active at the edge.
- [ ] QMS DB user is **SELECT-only** on views; no base-table or write grants.
- [ ] `QMS_DB_CA` set so DB connections use **verified TLS**.
- [ ] Application DB password is strong; DB not exposed to the host/network
      beyond the app (`db` port stays unpublished in Compose).
- [ ] `APP_CONFIG_DIR` is a **persistent volume**, backed up, and not world-readable.
- [ ] Container runs as **non-root** (it does by default) — don't override the user.
- [ ] `SESSION_MAX_AGE`, `AUTH_MAX_FAILED`, `AUTH_LOCKOUT_MINUTES` reviewed for
      your policy.
- [ ] Reverse proxy sets `X-Forwarded-Proto https`.
- [ ] Logs shipped to your SIEM; schedule an audit-chain integrity check.
- [ ] `.env` file permissions restricted (`chmod 600 .env`).

---

## 10. Backups & restore

Two things to back up: the **application database** and the **`APP_CONFIG_DIR`
volume** (config + generated reports + attachments + logo). The QMS replica is
owned by the bank and not your responsibility.

Back up the volume:

```bash
docker run --rm -v qms_data:/data -v "$PWD":/backup alpine \
  tar czf /backup/qms_data-$(date +%F).tgz -C /data .
```

Back up the app database (bundled MySQL example):

```bash
docker compose exec db sh -c \
  'exec mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" appdb' > appdb-$(date +%F).sql
```

Restore is the reverse: recreate the volume from the tarball and import the SQL
dump, then start the app. Keep the DB and volume backups **from the same time**
so report metadata and files stay consistent.

---

## 11. Upgrades

```bash
cd qms-dashboard
git pull
docker compose up -d --build        # rebuild + restart, volumes preserved
docker compose logs -f app
```

The schema DDL is idempotent (`CREATE TABLE IF NOT EXISTS` / guarded), so app
restarts are safe. Take a backup (section 10) before major upgrades. Roll back by
checking out the previous tag and rebuilding.

---

## 12. Observability

- **Health:** `GET /api/health` (liveness — always 200 if the process answers,
  used by the container HEALTHCHECK) and `GET /api/health?deep=1` (readiness —
  503 if a database is unreachable, with per-dependency booleans).
- **Logs:** the app writes to stdout/stderr — use `docker compose logs -f app` or
  a Docker log driver to ship them.
- **Audit:** administrative and sign-in activity is in `app_audit_log`, viewable
  on the Audit page with an integrity indicator; export as CSV for records.

```bash
curl -fsS "https://qms.bank.internal/api/health?deep=1" | jq
# {"status":"ok","configured":true,"checks":{"appDb":true,"qmsDb":true}, ...}
```

---

## 13. Why not Vercel

The user asked about Vercel. It is **not recommended** for this app:

- **Ephemeral filesystem.** The `/setup` flow writes `app-config.json`, and
  generated reports / attachments / the logo all live under `APP_CONFIG_DIR`.
  Serverless functions don't persist local files between invocations.
- **No warm connection pools.** The app relies on long-lived MySQL/SQL Server
  pools; serverless spins up per-request, exhausting DB connections.
- **Network reach.** A bank's read-only QMS replica generally isn't reachable
  from a public serverless platform, and shouldn't be.

If you must use Vercel for a demo, you'd have to externalise all file storage to
an object store, move config to env/secret storage, and use a serverless-friendly
database proxy — a substantial re-architecture. For the intended on-prem bank
deployment, **run the container** as in Options A/B above.

---

## 14. Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| App container `unhealthy` | `docker compose logs app`. Usually a missing `AUTH_SECRET` or an unreachable DB. `curl "…/api/health?deep=1"` isolates which DB. |
| Redirect loop to `/setup` | App DB not configured (or the volume was reset). Complete the wizard. |
| `/setup` says "already configured" | Expected post-go-live. Remove `app-config.json` from the volume and restart to redo it. |
| `db` won't start / init SQL ignored | The init script only runs on an **empty** data volume. `docker compose down -v` to reset (destroys data), then `up`. |
| Login always fails | Wrong app-DB creds, or the user is inactive/locked. `docker compose exec app node scripts/reset-password.mjs …`. |
| Native module errors on build | Ensure you build the image on Linux (the Dockerfile does); don't copy Windows `node_modules` into the image. |
| Dashboards empty | The `qms` views have no data — load a QMS dump / verify the views exist. |

More context in [`ARCHITECTURE.md`](ARCHITECTURE.md). Test guidance in
[`TESTING.md`](TESTING.md).
