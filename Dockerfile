# syntax=docker/dockerfile:1
# Production image: `docker build -t proofstack .`
# Runtime needs only .output/ (server bundle, public assets, migrate.mjs) and drizzle/ (SQL migrations).
# See docs/operations.md for environment variables, migrations and the deploy sequence.

# Pinned by digest; the same reference as `node` in scripts/images.ts (`pnpm ci:workflows` checks the copy).
ARG NODE_IMAGE=node:26.10.0-slim@sha256:ec7758ee051e457b468b32bde57b0879010b325bb9862718e9615225ce4aaae1

FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV CI=true
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Node 26 no longer ships corepack. Install the pnpm that package.json#packageManager names (`pnpm@<version>`,
# optionally followed by `+<hash>`), so the version has one source.
RUN npm install --global --no-fund --no-audit \
      "$(node -p "require('./package.json').packageManager.split('+')[0]")" \
 && npm cache clean --force \
 && pnpm --version
RUN --mount=type=cache,id=proofstack-pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --store-dir /pnpm-store
COPY . .
# Nitro prerenders /about during the build, which loads the server config. These placeholders only
# satisfy validation; nothing connects to them and none of them ends up in the output.
RUN DATABASE_URL=postgres://build:build@127.0.0.1:1/build \
    APP_URL=http://localhost:3000 \
    BETTER_AUTH_SECRET=build-time-placeholder-not-used-at-runtime \
    NODE_OPTIONS=--max-old-space-size=3072 \
    pnpm build \
 && test -f .output/public/about/index.html \
 && node scripts/migrate-bundle.ts

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app
# Application files stay owned by root: the server process cannot modify its own code.
COPY --from=build /app/.output ./.output
COPY --from=build /app/drizzle ./drizzle
USER node
EXPOSE 3000
# srvx (Nitro's server) drains in-flight requests on SIGTERM, then Nitro's close hook runs the shutdown
# steps, the Postgres pool last (src/server/lifecycle.ts). Graceful timeout: 5 s
# (SERVER_SHUTDOWN_TIMEOUT), below Docker's default 10 s stop timeout.
STOPSIGNAL SIGTERM
# The probe runs inside the container and resolves the address the way Nitro's server does: NITRO_PORT or
# PORT (default 3000), NITRO_HOST or HOST, with loopback when that is unset or a wildcard. It speaks plain
# HTTP, so replace it if the server itself terminates TLS (NITRO_SSL_CERT).
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 \
  CMD ["node", "-e", "const e = process.env, h = e.NITRO_HOST || e.HOST || '', port = e.NITRO_PORT || e.PORT || 3000; const host = ['', '0.0.0.0', '::'].includes(h) ? '127.0.0.1' : h.includes(':') ? `[${h}]` : h; fetch(`http://${host}:${port}/api/health`).then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", ".output/server/index.mjs"]
