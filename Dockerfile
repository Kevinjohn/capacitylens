# syntax=docker/dockerfile:1
#
# Multi-stage build for CapacityLens. ONE Dockerfile, two runtime targets, no
# server code change — standard SPA + API split:
#
#   --target api : Node 24, runs the Fastify daemon (`tsx server/src/index.ts`)
#                  against a SQLite DB on a named volume (node:sqlite, no flag).
#   --target web : nginx serving the built Vite SPA and proxying /api -> api.
#
# docker-compose.yml selects each target. Node 24 is required for node:sqlite
# and matches `.nvmrc` / the "engines": { "node": ">=24" } across all manifests.

# ---------------------------------------------------------------------------
# Stage 1 — deps: install the full workspace (root + shared + server) from the
# lockfile. Kept separate so the install layer caches independently of source.
# pnpm comes via corepack, pinned by "packageManager" in package.json.
# ---------------------------------------------------------------------------
FROM node:24-bookworm-slim AS deps
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

# Only the manifests + lockfile -> this layer is reused unless deps change.
# pnpm-workspace.yaml also carries onlyBuiltDependencies (the esbuild approval),
# so the install here runs the same postinstall policy as a host install.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/

# Full install (incl. dev deps): the build stage needs Vite/tsc, and the server
# runs via tsx (a dev dependency of the server workspace) at runtime.
RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# Stage 2 — build: compile the client SPA. VITE_CAPACITYLENS_API is inlined at
# build time. EMPTY (the default) = SERVER MODE against the SAME ORIGIN: the client
# composes `${API_BASE}/api/...` -> a relative `/api/...` that nginx (the web stage)
# reverse-proxies to the api service, so it works on ANY host with no per-host
# rebuild. Pass --build-arg VITE_CAPACITYLENS_API=https://your.host ONLY to point the
# SPA at a DIFFERENT origin (the ORIGIN, NOT "/api" — that would double to /api/api/...).
# ---------------------------------------------------------------------------
FROM deps AS build
WORKDIR /app

ARG VITE_CAPACITYLENS_API=""
# VITE_CAPACITYLENS_DEMO=1 builds the LOCALSTORAGE DEMO image (no backend; it wins over
# the API var). Empty (the default) is the standard SERVER build above.
ARG VITE_CAPACITYLENS_DEMO=""
ARG VITE_CAPACITYLENS_BUILD_SHA=""
ARG VITE_CAPACITYLENS_FEEDBACK_MAILTO=""
ENV VITE_CAPACITYLENS_API=${VITE_CAPACITYLENS_API}
ENV VITE_CAPACITYLENS_DEMO=${VITE_CAPACITYLENS_DEMO}
ENV VITE_CAPACITYLENS_BUILD_SHA=${VITE_CAPACITYLENS_BUILD_SHA}
ENV VITE_CAPACITYLENS_FEEDBACK_MAILTO=${VITE_CAPACITYLENS_FEEDBACK_MAILTO}

# Source for both the client build and the server runtime copy below.
COPY . .

# tsc -b + vite build -> dist/
RUN pnpm run build

# ---------------------------------------------------------------------------
# Stage 3 — api: the Fastify server. It runs via tsx, so it ships its TS source
# (server/ + shared/) plus the workspace node_modules (which include tsx and the
# server's runtime deps: fastify, @fastify/rate-limit, better-auth). We copy the
# already-installed tree from `deps` rather than re-installing.
# ---------------------------------------------------------------------------
FROM node:24-bookworm-slim AS api
WORKDIR /app
ENV NODE_ENV=production
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# corepack's cache must live somewhere the unprivileged `node` user (set via
# USER below) can READ at container start — the default is ~/.cache under the
# BUILD user's home (/root, mode 0700, invisible to `node`), which would send
# the runtime `pnpm` shim back to the network to re-fetch and crash-loop an
# offline host. Pin it to a world-readable path inside /app instead.
ENV COREPACK_HOME=/app/.corepack
# In a container we deliberately bind all interfaces (the host default is
# loopback-only). compose publishes nothing for api directly; nginx reaches it
# over the compose network.
ENV CAPACITYLENS_HOST=0.0.0.0

# Installed workspace: pnpm keeps the real packages in node_modules/.pnpm and
# gives each workspace its own node_modules of RELATIVE symlinks into it, so
# all three trees must travel together (COPY preserves the symlinks).
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/shared/node_modules ./shared/node_modules
COPY --from=deps /app/server/node_modules ./server/node_modules
# Manifests so `pnpm --filter capacitylens-server start` resolves the workspace.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
# `corepack enable` only wires up shims (pnpm/pnpm.cjs) that fetch the real
# pnpm tarball from the registry on first invocation — without a bake step,
# that fetch happens at CONTAINER START (the CMD below), crash-looping any
# air-gapped/offline host. `corepack install` (no -g) downloads and caches the
# package manager PINNED BY THE package.json JUST COPIED ABOVE, so the version
# lives in exactly one place ("packageManager" in package.json) instead of
# being re-hardcoded here.
RUN corepack enable && corepack install
# TS source the server imports at runtime (server entry + the shared core), plus the
# scripts/ preflight the start script chains before tsx (node scripts/check-node.mjs && …) —
# without it the CMD dies on MODULE_NOT_FOUND before the server ever boots.
COPY server/src ./server/src
COPY server/scripts ./server/scripts
COPY shared/src ./shared/src

# Drop root: run the daemon as the image's built-in unprivileged `node` user.
# The DB (/data) and the backups dir (/backups) are named volumes — create their
# mount points owned by `node` FIRST, so Docker initialises a fresh, empty volume
# with that ownership (an empty named volume inherits the image directory's
# uid/gid on its first mount; without this the daemon can't write the DB and the
# container restart-loops). The copied node_modules + TS source stay root-owned:
# tsx/pnpm only READ them, and the corepack cache lives at COREPACK_HOME (set
# above, world-readable), not under /root.
RUN mkdir -p /data /backups && chown node:node /data /backups
USER node

EXPOSE 8787

# /api/health is unauthenticated and rate-limit-exempt; default { ok: true }.
# Uses Node's global fetch (Node 24) so no extra package is needed.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["pnpm", "--filter", "capacitylens-server", "start"]

# ---------------------------------------------------------------------------
# Stage 4 — web: nginx serving the built SPA + proxying /api -> the api service.
# ---------------------------------------------------------------------------
FROM nginx:alpine AS web
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
