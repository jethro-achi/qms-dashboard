# Deploying at the bank — custom domain + HTTPS

This is the plug-and-play guide for putting the dashboard behind a real hostname
(`http(s)://QMS-DASHBOARD/`) with TLS. **Nothing in the application is hardcoded
to a host** — the same image serves whatever hostname reaches it — so deployment
is three external steps: a DNS record, a certificate, and starting the bundled
nginx reverse proxy.

The proxy is defined in `docker-compose.yml` under the `proxy` profile, so it
stays **off** during normal `docker compose up` and only runs when you ask for it.

---

## 1. DNS — point the name at the server

Have the bank's IT team map the hostname to the server running Docker:

- **Bare intranet name** (`QMS-DASHBOARD`): an internal DNS A-record, or a WINS /
  `hosts` entry on client machines, resolving `QMS-DASHBOARD` → server IP.
- **FQDN** (`qms.bank.internal`): a normal internal A-record.

Whatever name you choose must match the certificate's CN/SAN (step 2) and the
`server_name` in `deploy/nginx/qms-dashboard.conf` (change it there if it isn't
`QMS-DASHBOARD`).

---

## 2. Certificate — CSR → bank CA → signed cert

Banks run their own internal CA that every domain-joined machine already trusts,
so a cert it signs shows **no browser warning**.

**a. Generate a key + CSR** (Git Bash / any machine with openssl):

```bash
openssl req -new -newkey rsa:2048 -nodes \
  -keyout qms-dashboard.key -out qms-dashboard.csr \
  -subj "/CN=QMS-DASHBOARD/O=Client Bank"
```

For a name with SANs, add `-addext "subjectAltName=DNS:QMS-DASHBOARD,DNS:qms.bank.internal"`.

**b.** Send `qms-dashboard.csr` to the bank's PKI team. They return a signed
certificate. Keep `qms-dashboard.key` private — it never leaves the server.

**c.** Assemble the **full chain** (server cert first, then intermediates) and
drop both files into `deploy/nginx/certs/`:

```
deploy/nginx/certs/qms-dashboard.crt   # server cert + intermediate(s)
deploy/nginx/certs/qms-dashboard.key   # private key
```

These names are what the nginx config expects. The directory is git-ignored
(only its README is tracked) so keys can't be committed by accident.

### Quick POC without the bank CA (self-signed)

For a throwaway demo where a browser warning is acceptable:

```bash
openssl req -x509 -newkey rsa:2048 -nodes -days 365 \
  -keyout deploy/nginx/certs/qms-dashboard.key \
  -out    deploy/nginx/certs/qms-dashboard.crt \
  -subj "/CN=QMS-DASHBOARD"
```

---

## 3. Run it

```bash
cp .env.example .env          # set secrets, DB creds (first time only)
docker compose --profile proxy up -d --build
```

Now browse to **https://QMS-DASHBOARD/**. The proxy:

- terminates TLS and forwards to the app over the isolated Docker network,
- redirects plain `http://` → `https://`,
- passes `X-Forwarded-Proto: https`, so Auth.js issues `Secure` session cookies,
- streams Server-Sent Events (live data-refresh + message alerts) unbuffered.

### Optional: stop exposing the app port directly

With the proxy fronting everything, you no longer need port 3000 on the host.
In `docker-compose.yml`, comment out the `app` service's `ports:` block so the
app is reachable **only** through nginx. (Leaving it published is harmless for a
POC but tightens the surface for production.)

---

## Can we run plain HTTP instead?

The app works over HTTP, but the session cookie can't carry the `Secure` flag,
so it's sniffable on the LAN. If the bank's network team insists on HTTP-only
internally, treat it as defense-in-depth: isolated VLAN + source-IP firewalling.
End-to-end HTTPS (or at minimum TLS terminated at this proxy) is the posture a
bank security review expects, and everything else — parameterized SQL, the
hash-chained audit log, branch-level RLS, Argon2id password hashing — is
transport-independent and stays in force either way.
