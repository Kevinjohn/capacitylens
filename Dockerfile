# syntax=docker/dockerfile:1
# One reproducible build, two non-root runtime targets: the SQLite API and nginx SPA.

FROM node:24-bookworm-slim@sha256:cb4e8f7c443347358b7875e717c29e27bf9befc8f5a26cf18af3c3dec80e58c5 AS deps
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
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
RUN pnpm --filter capacitylens-server deploy --prod --legacy /prod/server

FROM node:24-bookworm-slim@sha256:cb4e8f7c443347358b7875e717c29e27bf9befc8f5a26cf18af3c3dec80e58c5 AS api
WORKDIR /app/server
ENV NODE_ENV=production
ENV CAPACITYLENS_HOST=0.0.0.0
COPY --from=server-deploy /prod/server ./
RUN mkdir -p /data /backups && chown node:node /data /backups
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node_modules/.bin/tsx", "src/index.ts"]

FROM nginxinc/nginx-unprivileged:1.31.2-alpine@sha256:6320020c7da8714feab524e02c08c5a1958675c4e68700e93a2fd8970b065786 AS web
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /app/dist /usr/share/nginx/html
# The inherited entrypoint mutates nginx config for optional templating/IPv6 behavior. CapacityLens
# ships a complete immutable config, so run nginx directly and keep the read-only root noise-free.
ENTRYPOINT []
CMD ["nginx", "-g", "daemon off;"]
EXPOSE 8080
