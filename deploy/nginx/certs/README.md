# TLS certificates for the reverse proxy

The nginx `proxy` service mounts this directory read-only at `/etc/nginx/certs`.
Place your CA-signed files here **with these exact names**:

    qms-dashboard.crt   full chain — server cert followed by any intermediate(s)
    qms-dashboard.key   private key

**The `.key` (and `.crt`) are git-ignored on purpose — never commit them.**
Only this README is tracked, so the directory exists in a fresh clone.

See `../../../DEPLOY.md` for the CSR → signed-cert flow and a self-signed
option for quick POC demos.
