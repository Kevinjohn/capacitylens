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
# lockfile. Kept separate so the npm ci layer caches independently of source.
# ---------------------------------------------------------------------------
FROM node:24-bookworm-slim AS deps
WORKDIR /app

# Only the manifests + lockfile -> this layer is reused unless deps change.
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/

# Full install (incl. dev deps): the build stage needs Vite/tsc, and the server
# runs via tsx (a dev dependency of the server workspace) at runtime.
RUN npm ci

# ---------------------------------------------------------------------------
# Stage 2 — build: compile the client SPA. VITE_CAPACITYLENS_API is inlined at
# build time, so it MUST be set here. The client composes `${API_BASE}/api/...`,
# so the value is the deployed ORIGIN (NOT "/api" — that would double the prefix
# to /api/api/...). Default targets the web service's published host port; pass
# --build-arg VITE_CAPACITYLENS_API=https://your.host for a real deploy.
# ---------------------------------------------------------------------------
FROM deps AS build
WORKDIR /app

ARG VITE_CAPACITYLENS_API=http://localhost:8080
ARG VITE_CAPACITYLENS_BUILD_SHA=""
ARG VITE_CAPACITYLENS_FEEDBACK_MAILTO=""
ENV VITE_CAPACITYLENS_API=${VITE_CAPACITYLENS_API}
ENV VITE_CAPACITYLENS_BUILD_SHA=${VITE_CAPACITYLENS_BUILD_SHA}
ENV VITE_CAPACITYLENS_FEEDBACK_MAILTO=${VITE_CAPACITYLENS_FEEDBACK_MAILTO}

# Source for both the client build and the server runtime copy below.
COPY . .

# tsc -b + vite build -> dist/
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 3 — api: the Fastify server. It runs via tsx, so it ships its TS source
# (server/ + shared/) plus the workspace node_modules (which include tsx and the
# server's runtime deps: fastify, @fastify/rate-limit, better-auth). We copy the
# already-installed tree from `deps` rather than re-installing.
# ---------------------------------------------------------------------------
FROM node:24-bookworm-slim AS api
WORKDIR /app
ENV NODE_ENV=production
# In a container we deliberately bind all interfaces (the host default is
# loopback-only). compose publishes nothing for api directly; nginx reaches it
# over the compose network.
ENV CAPACITYLENS_HOST=0.0.0.0

# Installed workspace (root node_modules + the hoisted/symlinked workspaces).
COPY --from=deps /app/node_modules ./node_modules
# Manifests so `npm start -w capacitylens-server` resolves the workspace.
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
# TS source the server imports at runtime (server entry + the shared core).
COPY server/src ./server/src
COPY shared/src ./shared/src

EXPOSE 8787

# /api/health is unauthenticated and rate-limit-exempt; default { ok: true }.
# Uses Node's global fetch (Node 24) so no extra package is needed.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "start", "-w", "capacitylens-server"]

# ---------------------------------------------------------------------------
# Stage 4 — web: nginx serving the built SPA + proxying /api -> the api service.
# ---------------------------------------------------------------------------
FROM nginx:alpine AS web
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
