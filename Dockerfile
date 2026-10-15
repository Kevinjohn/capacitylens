# Use BuildKit's bundled frontend to avoid a separate Docker Hub syntax-image pull.

# Publisher mirrors retain the pinned images without Docker Hub's anonymous pull quota.
FROM public.ecr.aws/docker/library/node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS deps
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
# better-sqlite3 compiles its native binding during the frozen dependency install.
RUN apt-get update \
    && apt-get install --yes --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY . .
RUN pnpm install --frozen-lockfile

FROM deps AS source

FROM source AS web-build
WORKDIR /app
ARG VITE_CAPACITYLENS_API=""
ARG VITE_CAPACITYLENS_DEMO=""
ARG VITE_CAPACITYLENS_BUILD_SHA=""
ARG VITE_CAPACITYLENS_FEEDBACK_MAILTO=""
ENV VITE_CAPACITYLENS_API=${VITE_CAPACITYLENS_API}
ENV VITE_CAPACITYLENS_DEMO=${VITE_CAPACITYLENS_DEMO}
ENV VITE_CAPACITYLENS_BUILD_SHA=${VITE_CAPACITYLENS_BUILD_SHA}
ENV VITE_CAPACITYLENS_FEEDBACK_MAILTO=${VITE_CAPACITYLENS_FEEDBACK_MAILTO}
RUN NODE_ENV=production CAPACITYLENS_ALLOW_OPEN_IN_PRODUCTION=1 HOST=127.0.0.1 PORT=0 LOG_LEVEL=error APP_KEY=capacitylens-build-key-0123456789abcdef APP_URL=http://127.0.0.1 SESSION_DRIVER=memory pnpm run build

FROM web-build AS web-client-build
# The client-only runtime has no same-origin proxy. Bake its validated remote API origin (if any)
# into the CSP rather than weakening connect-src or templating mutable runtime configuration.
RUN node scripts/render-client-nginx.mjs nginx.client.conf.template /tmp/nginx.client.conf

# Deployment runs in this disposable build stage, preserving the pinned local archive.
FROM web-build AS server-deploy
RUN pnpm --filter @capacitylens/backend deploy --prod --legacy --no-optional /runtime-deploy \
    && node scripts/prepare-container-runtime.mjs /app /runtime-deploy /prod/backend

FROM public.ecr.aws/docker/library/node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS api
WORKDIR /app/backend
ENV NODE_ENV=production
ENV HOST=0.0.0.0 PORT=8787 SESSION_DRIVER=database
COPY --from=server-deploy /prod/backend ./
# Apply Debian security updates and remove package managers that the runtime does not need.
RUN apt-get update \
    && apt-get upgrade --yes \
    && rm -rf /var/lib/apt/lists/* \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /opt/yarn-v1.22.22 /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
      /usr/local/bin/yarn /usr/local/bin/yarnpkg \
    && mkdir -p /data /backups \
    && chown node:node /data /backups
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/health/ready',{signal:AbortSignal.timeout(4000)}).then(r=>{if(!r.ok)process.exitCode=1}).catch(()=>{process.exitCode=1})"]
CMD ["node", "bin/server.js"]

FROM ghcr.io/nginx/nginx-unprivileged:1.31.6-alpine@sha256:26b0bf6fbf07297983cb341998d79c831508787de26627dd2a112321b9c3a4af AS web-runtime
USER root
# The base installs curl for its generic entrypoint, which this image deliberately does not use.
# Remove curl/libcurl rather than retaining an unnecessary network client and its CVE surface.
# Apply Alpine security updates before Compose runs this image with a read-only filesystem.
RUN apk upgrade --no-cache && apk del --no-cache curl libcurl
USER 101
COPY nginx-security-headers.conf /etc/nginx/capacitylens-security-headers.conf
COPY --from=web-build /app/apps/frontend/dist /usr/share/nginx/html
# The inherited entrypoint mutates nginx config for optional templating/IPv6 behavior. CapacityLens
# ships a complete immutable config, so run nginx directly and keep the read-only root noise-free.
ENTRYPOINT []
CMD ["nginx", "-g", "daemon off;"]
EXPOSE 8080

FROM web-runtime AS web-client
COPY --from=web-client-build /tmp/nginx.client.conf /etc/nginx/conf.d/default.conf

# Keep the web image as the Dockerfile's final/default target. Direct API builds must select the
# `api` target explicitly.
FROM web-runtime AS web
COPY nginx.conf /etc/nginx/conf.d/default.conf
