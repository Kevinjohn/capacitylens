# syntax=docker/dockerfile:1
# One reproducible build, two non-root runtime targets (SQLite API and nginx SPA) plus a
# one-shot, least-privilege initializer for the per-install internal TLS certificate set.

FROM node:24-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS deps
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

# The server intentionally executes TypeScript because @capacitylens/shared exports its source.
# `tsx` is therefore a pinned runtime dependency. This deploy omits Vite, Playwright, Vitest,
# TypeScript, ESLint and every other development-only package from the API image.
FROM source AS server-deploy
RUN pnpm --filter capacitylens-server deploy --prod /prod/server
# Fail the image build if optional web/test peers leak back into the isolated API graph.
RUN for package in vite vitest jsdom eslint react react-dom playwright playwright-core typescript; do \
      test -z "$(find /prod/server/node_modules/.pnpm -mindepth 1 -maxdepth 1 -type d -name "$package@*" -print -quit)" \
      || { echo "unexpected API runtime package: $package" >&2; exit 1; }; \
    done

FROM node:24-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS api
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
  CMD node -e "const fs=require('node:fs'),https=require('node:https'),port=process.env.PORT||8787,ca=process.env.CAPACITYLENS_INTERNAL_TLS_CA;if(!ca){fetch('http://127.0.0.1:'+port+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1));}else{https.get({hostname:'127.0.0.1',port,path:'/api/health',ca:fs.readFileSync(ca),servername:'api'},r=>process.exit(r.statusCode>=200&&r.statusCode<300?0:1)).on('error',()=>process.exit(1));}"
CMD ["node_modules/.bin/tsx", "src/index.ts"]

FROM alpine:3.23.5@sha256:fd791d74b68913cbb027c6546007b3f0d3bc45125f797758156952bc2d6daf40 AS internal-tls
RUN apk add --no-cache openssl
COPY scripts/internal-tls.sh /usr/local/bin/capacitylens-internal-tls
ENTRYPOINT ["/usr/local/bin/capacitylens-internal-tls"]

FROM nginxinc/nginx-unprivileged:1.31.2-alpine@sha256:6320020c7da8714feab524e02c08c5a1958675c4e68700e93a2fd8970b065786 AS web
USER root
# The base installs curl for its generic entrypoint, which this image deliberately does not use.
# Remove curl/libcurl rather than retaining an unnecessary network client and its CVE surface.
RUN apk del --no-cache curl libcurl
USER 101
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /app/dist /usr/share/nginx/html
# The inherited entrypoint mutates nginx config for optional templating/IPv6 behavior. CapacityLens
# ships a complete immutable config, so run nginx directly and keep the read-only root noise-free.
ENTRYPOINT []
CMD ["nginx", "-g", "daemon off;"]
EXPOSE 8080
