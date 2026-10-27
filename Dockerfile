# syntax=docker/dockerfile:1
# Ijazat server image, built from THIS repository's source (not the upstream npm package), so
# the DPDP flow, regimes and checker changes are included. Used by `docker compose up`.

# ── Build ─────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
COPY apps/ui ./apps/ui
# Only the workspaces the server needs: skips the docs site and Playwright-based tooling.
# Behind a TLS-intercepting proxy, pass its CA: docker build --secret id=ca,src=/path/ca.pem .
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi && \
    npm ci --no-audit --no-fund --include-workspace-root \
      --workspace=packages/types --workspace=packages/utils \
      --workspace=apps/ui --workspace=apps/api
# The API build copies the widget out of apps/ui/dist, so the widget is built first.
RUN npx turbo build --filter=@consenti/ui... \
 && npx turbo build --filter=@consenti/api...

# ── Run ───────────────────────────────────────────────────────────────────────
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# The API bundle has no runtime dependencies. pg / mysql2 / mongodb are the optional drivers for
# CONSENTI_DB_DRIVER=postgresql|mysql|mongodb; the default node:sqlite driver is built into Node.
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi && \
    npm init -y >/dev/null && npm install --omit=dev --no-audit --no-fund pg mysql2 mongodb
COPY --from=build /src/apps/api/package.json ./node_modules/@consenti/api/package.json
COPY --from=build /src/apps/api/dist ./node_modules/@consenti/api/dist
COPY docker/server.mjs ./server.mjs
ENV CONSENTI_DB_DRIVER=node:sqlite
ENV CONSENTI_DB_PATH=/data/consenti-data
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]
EXPOSE 3000
USER node
CMD ["node", "server.mjs"]
