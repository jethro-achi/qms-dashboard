# syntax=docker/dockerfile:1
# =============================================================================
# QMS Analytics Dashboard — production image
#
# Multi-stage build producing a small, non-root Next.js "standalone" runtime.
#   1. deps    — install node_modules (cached unless package.json changes)
#   2. builder — compile the app; `output: "standalone"` traces only the
#                node_modules actually needed and emits server.js
#   3. runner  — copy the traced bundle onto a clean base, drop root, run
#
# Base image is Debian (bookworm) slim, NOT Alpine: the native modules
# (@node-rs/argon2, mysql2, mssql) ship prebuilt glibc binaries, so glibc avoids
# musl rebuild pain.
# =============================================================================

# ---- 1. deps ----------------------------------------------------------------
FROM node:22-bookworm-slim AS deps
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# Copy only the manifests first so this layer caches across source changes.
# A lockfile is honoured if committed (reproducible); otherwise fall back to a
# plain install so the image still builds from a fresh clone.
COPY package.json package-lock.json* pnpm-lock.yaml* ./
RUN if [ -f package-lock.json ]; then npm ci; \
    else echo "No package-lock.json committed — using 'npm install'"; npm install; fi

# ---- 2. builder -------------------------------------------------------------
FROM node:22-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# `public/` may not exist in a fresh clone; ensure it does so the runner COPY
# below never fails.
RUN mkdir -p public && npm run build

# ---- 3. runner --------------------------------------------------------------
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    # Persistent state (app-config.json, reports, attachments, logo) lives here.
    # Mount a volume at this path — see docker-compose.yml.
    APP_CONFIG_DIR=/var/lib/qms-dashboard

# Run as an unprivileged user; create the data dir it owns.
RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs \
    && mkdir -p /var/lib/qms-dashboard \
    && chown -R nextjs:nodejs /var/lib/qms-dashboard

# The standalone bundle: server.js + the minimal traced node_modules.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000
VOLUME ["/var/lib/qms-dashboard"]

# Liveness probe: the process answered. A DB blip won't kill the container
# (use /api/health?deep=1 for readiness at the load balancer instead).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
