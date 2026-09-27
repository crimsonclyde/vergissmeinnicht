# syntax=docker/dockerfile:1
#
# Vergissmeinnicht production image (docu/deployment.md, steps.md 10.1).
# One process: the Fastify server serving the API and the built web app. Runs as the unprivileged
# `node` user; all persistent data lives in /data. No secrets are baked in: configuration and
# secrets are injected at runtime (environment or *_FILE Docker secrets).

# Pinned by digest; Dependabot (docker ecosystem) proposes updates.
ARG NODE_IMAGE=node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6

# ---- Toolchain: pnpm and what better-sqlite3 needs if no prebuilt binary is available.
FROM ${NODE_IMAGE} AS toolchain
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g pnpm@12.6.0
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/application/package.json packages/application/
COPY packages/auth/package.json packages/auth/
COPY packages/database/package.json packages/database/
COPY packages/domain/package.json packages/domain/
COPY packages/email/package.json packages/email/
COPY packages/import-export/package.json packages/import-export/
COPY packages/permissions/package.json packages/permissions/
COPY packages/realtime/package.json packages/realtime/
COPY packages/ui/package.json packages/ui/

# ---- Web build: all dependencies, then the static bundle.
FROM toolchain AS web
RUN pnpm install --frozen-lockfile
COPY apps/web apps/web
COPY packages packages
RUN pnpm --filter @vergissmeinnicht/web build

# ---- Runtime dependencies of the server only (no dev tools, no React/Vite).
FROM toolchain AS server-deps
RUN pnpm install --frozen-lockfile --prod --filter "@vergissmeinnicht/server..."

# ---- Runtime image.
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATABASE_PATH=/data/vergissmeinnicht.sqlite
WORKDIR /app
COPY --from=server-deps /app /app
COPY apps/server/src apps/server/src
COPY packages packages
COPY --from=web /app/apps/web/dist apps/web/dist
COPY LICENSE ./
COPY deploy/docker-entrypoint.sh /usr/local/bin/vergissmeinnicht
RUN chmod 0755 /usr/local/bin/vergissmeinnicht \
  && mkdir -p /data \
  && chown node:node /data \
  && chmod 0700 /data
USER node
VOLUME ["/data"]
EXPOSE 3000
# Ready = database reachable and all migrations applied (GET /api/health/ready).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health/ready').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
ENTRYPOINT ["vergissmeinnicht"]
CMD ["serve"]
