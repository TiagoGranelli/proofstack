# Operations

How to configure, deploy and run ProofStack in production. The app is a single Node process
(Nitro `node-server` output in `.output/`) in front of PostgreSQL.

## Environment

The server validates the variables read by `src/server/env.ts` while it starts (loaded by the Nitro
plugin `src/server/nitro/startup.ts`): `DATABASE_URL`, `APP_URL`, `BETTER_AUTH_SECRET`,
`TRUSTED_IP_HEADER` and `DATABASE_POOL_MAX`. An invalid value stops the process with exit code 1 and a
message naming the variable, before the port opens. The other variables are read by Nitro and srvx
without validation: a non-numeric port silently falls back to 3000, and a non-numeric
`SERVER_SHUTDOWN_TIMEOUT` to 5.

| Variable | Required | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | yes | `postgres://` connection string. |
| `APP_URL` | yes | Public origin as browsers see it: scheme, host and port, no path (`https://app.example.com`). |
| `BETTER_AUTH_SECRET` | yes | At least 32 characters; signs session cookies. Generate with `openssl rand -base64 32`. |
| `TRUSTED_IP_HEADER` | behind a proxy | Header your reverse proxy sets to the client IP. See [Client IP](#client-ip-and-rate-limiting). |
| `DATABASE_POOL_MAX` | no | Postgres connections per process, 1 to 100. Default 10. |
| `PORT`, `HOST` | no | Listen address. Default port 3000 on all interfaces. `NITRO_PORT` and `NITRO_HOST` take precedence when set. |
| `NITRO_SSL_CERT`, `NITRO_SSL_KEY` | no | Serve HTTPS from Node: PEM text or file paths. Both must be set; with only one, the server silently serves plain HTTP. |
| `SERVER_SHUTDOWN_TIMEOUT` | no | Seconds to drain requests on SIGTERM. Default 5. |
| `NODE_ENV` | no | The production build behaves as production regardless; the Docker image sets it anyway. |

The migration script (`node .output/migrate.mjs`, `pnpm db:migrate`) reads `DATABASE_URL` and:

| Variable | Default | Meaning |
| --- | --- | --- |
| `MIGRATIONS_FOLDER` | `drizzle` | Folder with the SQL files and `meta/_journal.json`, relative to the working directory. |
| `MIGRATE_LOCK_TIMEOUT` | `5min` | Longest wait for another instance's migration run (Postgres `lock_timeout` syntax). |
| `MIGRATE_DDL_LOCK_TIMEOUT` | `5s` | Longest wait for each table lock the DDL takes. See [Build and deploy](#build-and-deploy). |

Keep `APP_URL` exactly equal to the public origin:

- CSRF protection rejects state-changing requests from other origins (see
  [Security settings](#security-settings)).
- Session cookies get the `__Secure-` prefix and the `Secure` flag only when `APP_URL` is `https://`.
  HSTS and `upgrade-insecure-requests` are also tied to it.
- SSR calls the API in-process, without a network hop, but the SDK client it uses has `APP_URL` as its
  base URL, and TanStack Query keys include the base URL. If `APP_URL` differs from the browser origin,
  the keys differ and the page refetches after hydration.

### Rotating `BETTER_AUTH_SECRET`

Changing the secret invalidates every session cookie; users sign in again. There is no overlap period.
Better Auth's `BETTER_AUTH_SECRETS` (versioned secrets) only covers data it encrypts, such as OAuth tokens,
which this app does not store, and it is not wired into `env.ts`. Do not set it.

## Build and deploy

The `Dockerfile` builds with the locked dependencies (`pnpm install --frozen-lockfile`) and produces an
image with only `.output/` and `drizzle/`, running as the unprivileged `node` user.

```sh
docker build -t proofstack .
```

`.output/` contains the server bundle, the public assets, and `migrate.mjs`, a self-contained bundle of
`scripts/migrate.ts` (built by `scripts/migrate-bundle.ts`). No `node_modules` are needed at runtime.

Deploy sequence:

1. Build the image (or `pnpm build && node scripts/migrate-bundle.ts` outside Docker).
2. Run the migrations once per deploy, before the new version receives traffic:
   ```sh
   docker run --rm -e DATABASE_URL=... proofstack node .output/migrate.mjs
   ```
   Several copies may start at once (for example as an init container per replica): a Postgres
   advisory lock serializes them, and migrations already recorded in `drizzle.__drizzle_migrations` are
   skipped. Without the lock, concurrent runs fail with duplicate-object errors. The script waits up to
   `MIGRATE_LOCK_TIMEOUT` (default `5min`) for the lock and exits non-zero on failure.
   While it runs DDL, every table lock it waits for is bounded by `MIGRATE_DDL_LOCK_TIMEOUT` (default
   `5s`): a migration stuck behind a long query on a busy table would otherwise make every later query
   on that table queue behind it. On a lock timeout the run rolls back (all pending migrations share
   one transaction) and is retried: up to 5 attempts in total, with pauses of 1, 2, 3 and 4 s between
   them, then it fails.
3. Start the new version. Route traffic when `GET /api/ready` returns 200.
4. Stop the old version with SIGTERM.

Migrations must stay backward compatible with the version still running during the rollout: add
columns and tables first, and remove them in a later deploy. Drizzle runs them inside a transaction, so
`CREATE INDEX` is not `CONCURRENTLY` and blocks writes to that table while the index builds; on a large
table, create the index by hand with `CREATE INDEX CONCURRENTLY` before the deploy.

Create the first account with `pnpm user:create <email> <name>` from a checkout of the repository with
its dependencies installed. The script loads the server's auth configuration, so `src/server/env.ts`
requires `DATABASE_URL`, `APP_URL` and `BETTER_AUTH_SECRET`; use the production values. It cannot run
from the Docker image, which contains only `.output/` and `drizzle/`. Sign-up is closed over HTTP
([ADR 0003](decisions/0003-closed-sign-up-cli-user-creation.md)).

## Reverse proxy

Terminate TLS in the proxy and forward to the app over HTTP. The proxy must:

- preserve the `Host`, `Origin`, `Referer` and `Sec-Fetch-*` headers;
- not buffer or rewrite `Set-Cookie`;
- set the client IP header named in `TRUSTED_IP_HEADER`, and overwrite (not append to) any value the
  client sent, or append it as the last entry.

For every method except GET, HEAD and OPTIONS, the app accepts request bodies up to 64 KiB (413 above
that, judged by `Content-Length`), answers 400 to a non-numeric `Content-Length`, and answers 411 to
chunked bodies (`Transfer-Encoding` without `Content-Length`). Proxies that buffer requests (nginx by
default) send a length.

### Edge proxy (Caddy)

`deploy/Caddyfile` is the reference edge, and the topology the tests measure: `pnpm lighthouse` always
runs through it, `pnpm verify:app --edge` optionally, and `pnpm ci:docker` serves the image behind it.
It uses Caddy 2.11.4 (image pinned by digest in `compose.yaml` and `scripts/images.ts`) and does four
things:

- **TLS:** with a domain as `EDGE_ADDRESS` (`app.example.com`), Caddy obtains and renews the certificate
  and redirects HTTP to HTTPS. `:8080` (the default) serves plain HTTP. Set `APP_URL` to the resulting
  origin.
- **Compression:** `encode zstd gzip` compresses what the app sends uncompressed: SSR HTML, API JSON.
  The build's precompressed `.br` assets already carry `Content-Encoding` and pass through unchanged, as
  do their `Cache-Control: public, max-age=31536000, immutable` headers. Nitro does not compress
  responses itself; compression is the edge's job.
- **No caching:** Caddy has no response cache. Nothing is stored, and `Cache-Control`, `ETag` and
  `Set-Cookie` reach the client as the app sent them, so `private` and `no-store` pages are never shared.
  `Host`, `Origin`, `Referer` and `Sec-Fetch-*` are forwarded as received.
- **Client IP:** Caddy resolves the client IP with its `trusted_proxies` rules and overwrites
  `X-Real-IP` with it (`header_up X-Real-IP {client_ip}`). Run the app with `TRUSTED_IP_HEADER=x-real-ip`.
  By default no proxy is trusted: the TCP peer is the client, and an `X-Forwarded-For` or `X-Real-IP`
  sent by the client is replaced. If a load balancer or CDN sits in front of Caddy, list its ranges in
  `EDGE_TRUSTED_PROXIES` (space-separated CIDRs, or `private_ranges`). With `trusted_proxies_strict`,
  Caddy walks `X-Forwarded-For` from the right and takes the first address that is not trusted, so a
  client cannot pick its IP by prepending entries.

Caddy streams request bodies without buffering them, so a chunked upload reaches the app without a
length and gets 411; browsers and the SDK always send `Content-Length`.

`EDGE_UPSTREAM` is the app's `host:port` (default `app:3000`). The admin API is off, so a configuration
change means restarting Caddy.

Try the whole production topology locally (Postgres, the image, migrations, the app, Caddy):

```sh
docker compose --profile edge up --build --wait   # http://localhost:8080 (EDGE_PORT); BETTER_AUTH_SECRET from .env
docker compose --profile edge down
```

The profile keeps `pnpm dev` and `pnpm db:up` to Postgres only. In front of a locally running build
(`pnpm lighthouse`, `pnpm verify:app --edge`), `scripts/edge.ts` starts the same Caddyfile, either from
the pinned image with `--network host` (`EDGE_RUNTIME=docker`, the default; Linux, because Docker
Desktop's host networking differs) or from a `caddy` binary (`EDGE_RUNTIME=binary`, `CADDY_BIN`), which
is what `pnpm ci:local` uses inside its container. The edge log goes next to the app log
(`test-results/edge.log`, `lighthouse-report/edge.log`).

### Client IP and rate limiting

The client IP keys the sign-in rate limit and is stored on each session.

- **`TRUSTED_IP_HEADER` unset:** the TCP peer address is the client IP. `X-Forwarded-For` and similar
  headers are ignored, so clients cannot choose their bucket. Use this only when clients connect to
  the Node process directly.
- **`TRUSTED_IP_HEADER` set:** when the TCP peer is a loopback or private address (`127.0.0.0/8`,
  `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `::1`, `fc00::/7`, `fe80::/10`), the last
  comma-separated value of that header is the client IP. If the peer is any other address, or the
  header is missing or invalid, the peer address is used, and a warning is logged once when the header
  arrives from a public address. A client that reaches the Node process directly therefore cannot
  choose its bucket or fill the rate-limit store with invented addresses. Your proxy must reach the app
  over loopback or a private network; a proxy that connects from a public address (for example
  Cloudflare straight to the origin) needs a local proxy in between. Examples: `x-real-ip` (the Caddy edge
  above, or nginx `proxy_set_header X-Real-IP $remote_addr`), `x-forwarded-for` with a single proxy that appends, `cf-connecting-ip`
  (Cloudflare), `fly-client-ip` (Fly.io). With several proxy layers, pick a header that only the outermost
  trusted layer sets, because the last hop of `X-Forwarded-For` would be your own proxy.

Behind a proxy without `TRUSTED_IP_HEADER`, every client appears with the proxy's address and shares one
bucket, so one attacker can block all sign-ins. The server logs a warning once when it sees
`X-Forwarded-For` from a private address while the variable is unset. Docker's port publishing on
`127.0.0.1` behaves the same way: local clients appear as the bridge gateway.

Limits (Better Auth, production build only): `/api/auth/sign-in/*` allows 3 requests per 10 seconds per
IP, including successful ones. Other auth endpoints allow 100 per minute. A limited request gets 429 with
`X-Retry-After`.

The counters live in process memory. Each instance counts separately and restarts reset them. With N
instances an attacker gets up to N times the budget. For several instances, give Better Auth shared
storage: `rateLimit.storage: 'database'` (needs a `rateLimit` table, `pnpm auth:generate`) or
`secondary-storage` backed by Redis.

## Health checks

| Endpoint | Meaning | Use for |
| --- | --- | --- |
| `GET /api/health` | The process answers HTTP. No dependencies are checked. | Liveness, the Docker `HEALTHCHECK` (see below) |
| `GET /api/ready` | Postgres answers `select 1`. Otherwise 503 with a JSON body carrying `"_tag":"ServiceUnavailable"` and `"message":"Database unavailable"`. | Readiness, load balancer routing |

Postgres connection attempts time out after 5 s, so `/api/ready` answers 503 within about 5 s even when
the database host does not respond. Do not use `/api/ready` for liveness: a database outage would restart
every instance without fixing anything.

The image's `HEALTHCHECK` fetches `/api/health` from inside the container over plain HTTP. It resolves
the address like the server does: `NITRO_PORT`, else `PORT`, else 3000; `NITRO_HOST`, else `HOST`, with
`127.0.0.1` when that is unset, `0.0.0.0` or `::`. If the server terminates TLS itself
(`NITRO_SSL_CERT` and `NITRO_SSL_KEY`), replace the probe.

## Shutdown

On SIGTERM or SIGINT, srvx (Nitro's HTTP server) stops accepting connections, waits for in-flight
requests up to `SERVER_SHUTDOWN_TIMEOUT` seconds (default 5) and then force-closes them. Nitro then runs
its `close` hook (`src/server/nitro/shutdown.ts`), which ends the Postgres pool and disposes the Effect
runtime. The SSR bundle registers those cleanups through a registry on `globalThis`
(`src/server/lifecycle.ts`), because the Nitro plugin and the SSR code are separate module instances.
The log line `shutdown complete` lists the cleanups that ran.

Measured with the Docker image: `docker stop` returns in about 1.2 s with exit code 0, including an idle
keep-alive connection. Keep the orchestrator's grace period above `SERVER_SHUTDOWN_TIMEOUT` (Docker's
default of 10 s is enough).

srvx skips its signal handling when `CI` or `TEST` is set in the environment (and `TEST` also hides its
startup line). Do not set either in production, or SIGTERM ends the process immediately without draining
or closing the pool. The Dockerfile sets `CI=true` only in its build stage, not in the runtime image.
`scripts/app-server.ts` (used by `verify:app` and `lighthouse`) removes both from the test server's
environment, so the tests exercise the production shutdown path even on CI, which sets `CI=true`.

## Logs

The production server logs one JSON object per line: `time`, `level`, `msg` and fields. Errors go to
stderr, the rest to stdout. The exceptions are srvx's own plain-text lines: the startup line
(`➜ Listening on: …`) on stdout, and the shutdown progress on stderr (`Stopping server gracefully (5s)...`,
then `Server closed successfully.` or `Graceful shutdown timed out.`). The progress line is redrawn in
place with carriage returns and ANSI erase-line sequences, and has no newline of its own, so the next
entry can appear on the same line in a log collector. `node .output/migrate.mjs` also logs JSON lines.
`pnpm dev` keeps framework output readable (raw, multi-line).

- `request`: `method`, `path` (without the query string), `status`, `ms`, for every response including
  static files. `/api/health`, `/api/ready`, `/assets/*` and `/favicon*` are logged only when they
  answer 400 or above. 5xx responses are logged at `error` level.
- `api defect`: an unexpected failure inside the Effect API, with the error chain. This includes a
  response that does not match its own schema (`ResponseSchemaError`, with the field paths but not the
  values). The client gets an empty 500.
- `auth request failed`: an unexpected Better Auth failure (for example, the database is down). The
  client gets an empty 500. Wrong passwords are `warn` entries from `source: "better-auth"`.
- `framework error` and `framework warning`: anything TanStack Start, h3, srvx or another library
  prints with `console.error` or `console.warn`, for example an exception thrown during SSR or inside a
  server function. `detail` holds the first line of the text, `error` the error chain. Start answers
  these requests with 500 on its own.
- `starting` and `shutdown complete` bracket the process lifetime. `starting` records `appUrl`,
  `trustedIpHeader` and `databasePoolMax`; `shutdown complete` lists the cleanups that ran.
- `shutdown cleanup failed`: a cleanup (`cleanup` field) rejected during shutdown.
- `uncaught exception, exiting` and `unhandled rejection`: see below.
- `postgres pool error`: an idle Postgres connection failed (for example, the database restarted).
- `ignoring TRUSTED_IP_HEADER from a public address` and
  `request has X-Forwarded-For from a private address but TRUSTED_IP_HEADER is unset`: `warn`, each at
  most once per process. See [Client IP](#client-ip-and-rate-limiting).

Logs never include headers, cookies, bodies or query strings. Error messages keep only their first
line, and stacks keep only their frames, because Drizzle and pg append SQL parameters (emails, session
tokens) on later lines.

After an uncaught exception the process logs it and exits with code 1 so the supervisor starts a clean
one. Unhandled promise rejections are logged and the process continues.

## Security settings

- **CSRF:** `src/start.ts` checks every request except GET, HEAD and OPTIONS to pages, server
  functions, `/api/*` and `/api/auth/*`. When `Sec-Fetch-Site` is present, it must be `same-origin`.
  Without it, the `Origin` header (or, if that is missing, the origin of `Referer`) must equal
  `APP_URL`. Anything else, including a request with none of these headers, gets 403 before
  authentication runs.
- **Auth endpoints:** only `POST /api/auth/sign-in/email`, `POST /api/auth/sign-out` and
  `GET /api/auth/get-session` are reachable (`src/server/http/auth-handler.ts`), the ones the UI uses.
  Every other Better Auth endpoint returns 404. Signing in again does not revoke a session the browser
  already held; that session stays valid until it expires or its user signs out from it.
- **Server functions:** a request to `/_serverFn/<id>` with an unknown id answers 404 (`src/start.ts`).
- **Cookies:** `HttpOnly`, `SameSite=Lax`, `Path=/`, 7-day expiry, and `__Secure-` plus `Secure` over
  https.
- **Headers:** every response gets `X-Content-Type-Options`, `X-Frame-Options: DENY`,
  `Referrer-Policy`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`, `Permissions-Policy`,
  a Content-Security-Policy, and HSTS over https (`src/server/nitro/http.ts`).
- **CSP:** SSR pages allow only scripts that carry the per-request nonce. Prerendered pages (`/about`)
  and other static responses use `script-src 'self' 'unsafe-inline'`, because static HTML cannot carry a
  per-request nonce. Styles allow `'unsafe-inline'` because Start inlines route CSS and React renders
  `style` attributes.
- **Caching:** each response sets its own `Cache-Control`; `src/start.ts` and the Nitro plugin never set
  or override it.
  - `/api/*` and `/api/auth/*` default to `no-store`.
  - SSR pages carry a per-request CSP nonce, so a shared cache must never reuse one: `/` sends
    `private, no-cache`, and `/login` and the `_authed` routes `private, no-store`.
  - Prerendered pages (`/about`) and `/assets/*` are static files served by Nitro. Hashed assets get
    `public, max-age=31536000, immutable`.
  The router, and with it the TanStack Query cache, is created per request, so SSR never shares cached
  data between users.
- **Public contract:** `/api/openapi.json` is public on purpose. It describes the same endpoints the
  browser already calls and contains no secrets. The `/api/me/*` operations declare the session cookie
  as two alternative `apiKey` security schemes, `sessionCookie` (`better-auth.session_token`, http) and
  `secureSessionCookie` (`__Secure-better-auth.session_token`, https); the server accepts whichever
  name Better Auth uses for the current `APP_URL`. Only operations that take input document a 400
  `ValidationError`.

## CI and local CI

Every job in `.github/workflows/ci.yml` runs one script; the YAML only checks out, sets up Node, pnpm,
browsers and Postgres, and moves artifacts. The logic lives in `scripts/ci-jobs.ts`:

| Script | Job |
| --- | --- |
| `pnpm ci:workflows` | actionlint 1.7.12 and zizmor 1.30.1 (images pinned by digest, offline, read-only), and a check that `compose.yaml` and `ci.yml` pin the same images as `scripts/images.ts`. Needs Docker. |
| `pnpm ci:static` | `pnpm check` without its drift gate |
| `pnpm ci:drift` | `pnpm check:drift`, all four checks (`DATABASE_URL`) |
| `pnpm ci:build` | `pnpm build` with placeholder configuration (the same as the Dockerfile's) |
| `pnpm ci:verify` | `verify:app` on all five Playwright projects |
| `pnpm ci:lighthouse` | `pnpm lighthouse --runs=5`, through the edge. Exit 2 means inconclusive (see AGENTS.md) |
| `pnpm ci:docker` | `scripts/docker-smoke.ts`: builds the image, migrates twice, serves it behind Caddy on a private network, checks pages through the edge, stops it gracefully. Brings its own Postgres. Needs Docker. |

`pnpm ci:local [job ...]` is the faithful local equivalent (default: every job, in CI order). It runs the
container jobs (`static`, `drift`, `build`, `verify`, `lighthouse`) in the official Playwright image
for `@playwright/test` 1.63.0 (Ubuntu 24.04, all browsers including WebKit), with Node from
`.node-version`, pnpm from `packageManager` and the pinned Caddy binary added, next to Postgres 18.6 on a
private Docker network. The host jobs (`workflows`, `docker`) drive Docker and run on the host.

- The repository is mounted read-only. The container copies what a CI checkout would contain (tracked
  files and untracked files that are not ignored, as they are on disk) and installs its own
  `node_modules` with `pnpm install --frozen-lockfile`; the host's `node_modules` and `.output` are never
  touched. The pnpm store is the volume `<prefix>-pnpm-store`, kept between runs.
- Limits: `CI_LOCAL_CPUS` (default 4, like a GitHub-hosted runner), `CI_LOCAL_MEMORY` (default `6g`, no
  swap) and `CI_LOCAL_SHM` (default `2g`; Chrome needs a large `/dev/shm`). Postgres keeps its data in
  memory (1 GB limit).
- `verify` and `lighthouse` add `build` when it is missing, like CI's `needs: build`. Jobs run one at a
  time; a Lighthouse run shares the machine with nothing else.
- Reports are copied to `test-results/ci-local/<job>/`. The summary lists every job's time and the
  runner container's peak memory (cgroup `memory.current`, including page cache, and anonymous memory).
- Containers and the network are named `<prefix>-local-<pid>-*` and removed at the end, also on Ctrl-C.
  `PROOFSTACK_DOCKER_PREFIX` sets the prefix (default `proofstack-ci`). The runner image
  (`<prefix>-runner:<hash>`) and the store volume stay for the next run; remove them with
  `docker image rm` and `docker volume rm`.

`act` still works as a smoke test of the YAML for the jobs without artifacts, but not as a CI
replacement: `actions/upload-artifact` v7 fails under act (nektos/act#6022).
