# syntax=docker/dockerfile:1
# One reproducible build, two non-root runtime targets (SQLite API and nginx SPA) plus a
# one-shot, least-privilege initializer for the per-install internal TLS certificate set.

FROM node:24-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS deps
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
COPY shared/package.json ./shared/
COPY server/package.json ./server/
RUN pnpm install --frozen-lockfile

FROM deps AS source
COPY . .

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
RUN pnpm run build

FROM web-build AS web-client-build
# The client-only runtime has no same-origin proxy. Bake its validated remote API origin (if any)
# into the CSP rather than weakening connect-src or templating mutable runtime configuration.
RUN node scripts/render-client-nginx.mjs nginx.client.conf.template /tmp/nginx.client.conf

# Bundle the API and its CPU-isolated import worker once during image construction. The production
# container executes plain JavaScript and carries neither the TypeScript transformer nor build tools.
FROM source AS server-deploy
RUN pnpm --filter capacitylens-server run build:runtime \
    && pnpm --filter capacitylens-server deploy --prod /prod/server
# Fail the image build if optional web/test peers leak back into the isolated API graph.
RUN for package in vite vitest jsdom eslint react react-dom playwright playwright-core typescript; do \
      test -z "$(find /prod/server/node_modules/.pnpm -mindepth 1 -maxdepth 1 -type d -name "$package@*" -print -quit)" \
      || { echo "unexpected API runtime package: $package" >&2; exit 1; }; \
    done

FROM node:24-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS api
WORKDIR /app/server
ENV NODE_ENV=production
ENV CAPACITYLENS_HOST=0.0.0.0
COPY --from=server-deploy /prod/server ./
# Package managers are build tools, not runtime requirements. The upstream Node image currently
# bundles an otherwise-unreachable vulnerable undici under npm; remove all unused npm/Corepack/Yarn
# tooling instead of shipping or suppressing it. Application dependencies live in ./node_modules.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /opt/yarn-v1.22.22 /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
      /usr/local/bin/yarn /usr/local/bin/yarnpkg \
    && mkdir -p /data /backups \
    && chown node:node /data /backups
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "scripts/check-health.mjs"]
CMD ["sh", "-c", "node scripts/check-node.mjs && exec node dist/index.mjs"]

FROM alpine:3.24.1@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b AS internal-tls
RUN apk add --no-cache openssl
COPY scripts/internal-tls.sh /usr/local/bin/capacitylens-internal-tls
ENTRYPOINT ["/usr/local/bin/capacitylens-internal-tls"]

FROM nginxinc/nginx-unprivileged:1.31.3-alpine@sha256:f972e5322b9797dc2a6b830030094426437b1ae7032e4644496395336ac6fdac AS web-runtime
USER root
# The base installs curl for its generic entrypoint, which this image deliberately does not use.
# Remove curl/libcurl rather than retaining an unnecessary network client and its CVE surface.
# Apply Alpine security patches (openssl, expat) not yet in the pinned base before the read-only root is sealed.
RUN apk upgrade --no-cache && apk del --no-cache curl libcurl
USER 101
COPY nginx-security-headers.conf /etc/nginx/capacitylens-security-headers.conf
COPY --from=web-build /app/dist /usr/share/nginx/html
# The inherited entrypoint mutates nginx config for optional templating/IPv6 behavior. CapacityLens
# ships a complete immutable config, so run nginx directly and keep the read-only root noise-free.
ENTRYPOINT []
CMD ["nginx", "-g", "daemon off;"]
EXPOSE 8080

FROM web-runtime AS web-client
COPY --from=web-client-build /tmp/nginx.client.conf /etc/nginx/conf.d/default.conf

# Keep the local-API image as the Dockerfile's final/default target for existing direct builds.
FROM web-runtime AS web
COPY nginx.conf /etc/nginx/conf.d/default.conf
