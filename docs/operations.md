# Operations

How to configure, deploy and run ProofStack in production. The app is a single Node process
(Nitro `node-server` output in `.output/`) in front of PostgreSQL.

## Environment

The server validates the variables read by `src/server/env.ts` while it starts (loaded by the Nitro
plugin `src/server/nitro/startup.ts`): `DATABASE_URL`, `APP_URL`, `BETTER_AUTH_SECRET`,
`TRUSTED_PROXIES`, `DATABASE_POOL_MAX`, `DATABASE_URL_POOLED`, `AUTH_SIGN_UP`, `SMTP_URL` and `MAIL_FROM`. An invalid value stops
the process with exit code 1 and a message naming the variable, before the port opens. So does the removed
`TRUSTED_IP_HEADER`, with a pointer to `TRUSTED_PROXIES`. The other variables are read by Nitro and srvx
without validation: a non-numeric port silently falls back to 3000, and a non-numeric
`SERVER_SHUTDOWN_TIMEOUT` to 5.

| Variable | Required | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | yes | `postgres://` connection string. |
| `APP_URL` | yes | Public origin as browsers see it: scheme, host and port, no path (`https://app.example.com`). |
| `BETTER_AUTH_SECRET` | yes | At least 32 characters; signs session cookies. Generate with `openssl rand -base64 32`. |
| `TRUSTED_PROXIES` | behind a proxy | Addresses or CIDR ranges of your reverse proxies, comma-separated (`127.0.0.1/32`, `10.0.0.0/8`). See [Client IP](#client-ip-and-rate-limiting). |
| `DATABASE_POOL_MAX` | no | Postgres connections per process, 1 to 100. Default 10. |
| `DATABASE_URL_POOLED` | behind a pooler | `true` when `DATABASE_URL` is a connection pooler (PgBouncer, Neon's `-pooler` host, Supabase's pooler). Default `false`. See [Connection poolers](#connection-poolers). |
| `AUTH_SIGN_UP` | no | `closed` (default): accounts come from `pnpm user:create`. `open`: anyone can sign up at `/sign-up`; needs `SMTP_URL`. See [Accounts and mail](#accounts-and-mail). |
| `SMTP_URL` | for mail | `smtps://user:password@smtp.example.com:465` (TLS) or `smtp://...:587` (STARTTLS when offered); credentials percent-encoded. Unset: mail is only logged. |
| `MAIL_FROM` | with `SMTP_URL` | Sender, such as `ProofStack <no-reply@example.com>`. |
| `PORT`, `HOST` | no | Listen address. Default port 3000 on all interfaces. `NITRO_PORT` and `NITRO_HOST` take precedence when set. |
| `NITRO_SSL_CERT`, `NITRO_SSL_KEY` | no | Serve HTTPS from Node: PEM text or file paths. Both must be set; with only one, the server silently serves plain HTTP. |
| `SERVER_SHUTDOWN_TIMEOUT` | no | Seconds to drain requests on SIGTERM. Default 5. |
| `NODE_ENV` | no | The production build behaves as production regardless; the Docker image sets it anyway. |

The migration script (`node .output/migrate.mjs`, `pnpm db:migrate`) reads:

| Variable | Default | Meaning |
| --- | --- | --- |
| `MIGRATION_DATABASE_URL` | `DATABASE_URL` | Where to migrate. Set it to a direct connection when `DATABASE_URL` goes through a pooler. |
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
   Several copies may start at once (for example as an init container per replica). Each run is one
   transaction that first takes a transaction-scoped advisory lock (`pg_advisory_xact_lock`), so the
   runs queue, and each reads `drizzle.__drizzle_migrations` only once it holds the lock: migrations
   already recorded there are skipped. Without the lock, concurrent runs fail with duplicate-object
   errors. The script waits up to `MIGRATE_LOCK_TIMEOUT` (default `5min`) for the lock and exits
   non-zero on failure. Its settings are `SET LOCAL`, so the run also works through a pooler in
   transaction mode (see [Connection poolers](#connection-poolers)); `tests/db/migrate.test.ts` starts
   three runs at once, and `pnpm ci:docker` does the same through PgBouncer.
   While it runs DDL, every table lock it waits for is bounded by `MIGRATE_DDL_LOCK_TIMEOUT` (default
   `5s`): a migration stuck behind a long query on a busy table would otherwise make every later query
   on that table queue behind it. On a lock timeout the run rolls back (all pending migrations share
   one transaction, which also releases the advisory lock) and is retried: up to 5 attempts in total,
   with pauses of 1, 2, 3 and 4 s between them, then it fails. The run turns off `statement_timeout` and
   `idle_in_transaction_session_timeout` for its transaction (`SET LOCAL ... = 0`), so the role-level
   timeouts meant for the app (see [Connection poolers](#connection-poolers)) cut short neither the wait
   for another run nor a long migration.
3. Start the new version. Route traffic when `GET /api/ready` returns 200.
4. Stop the old version with SIGTERM.

Migrations must stay backward compatible with the version still running during the rollout: add
columns and tables first, and remove them in a later deploy (expand, then contract). All pending
migrations run in one transaction, which has consequences:

- `CREATE INDEX CONCURRENTLY` cannot run in a transaction, and a plain `CREATE INDEX` blocks writes to the
  table while it builds. On a large table, build the index by hand before the deploy (see below).
- `ADD CONSTRAINT ... NOT VALID` followed by `VALIDATE CONSTRAINT` in the same run gains nothing: the
  validation scan runs while the transaction still holds the exclusive lock the `ADD` took. Put the
  `VALIDATE` in a migration of the next deploy.
- A data backfill in the same transaction as the DDL holds the DDL's locks for the whole backfill. Backfill
  large tables in batches between two deploys.

Migrations are forward only: there are no down migrations. To undo a change, write a new migration that
reverts it and deploy that. When a migration destroyed data, restore from a backup
([Backups and restore](#backups-and-restore)).

### Migration safety

`pnpm check:migrations` (a gate of `pnpm check`, so of CI's `static` job) runs
[squawk](https://squawkhq.com/docs/rules) 2.66.0 over `drizzle/*.sql` and fails on any finding: a
non-concurrent index, a column type change that rewrites the table, a `NOT NULL` or constraint that scans
it under an exclusive lock, and so on. The configuration is `.squawk.toml`: Postgres 18, every file assumed
to run in a transaction (`scripts/migrate.ts`), and three rules off because `scripts/migrate.ts` already
covers them (`prefer-robust-stmts`, `require-lock-timeout`, `require-statement-timeout`; the file says
why). Migrations 0000 to 0004 were applied before the lint existed and are grandfathered in its
`excluded_paths`; every later one is linted. squawk is the release binary for the platform, pinned by
sha256 in `scripts/check-migrations.ts` and cached in `~/.cache/proofstack/` (the first run downloads it,
later runs are offline). Each run first checks that squawk still flags a plain `CREATE INDEX`.

When a finding is expected, waive that one statement with `-- squawk-ignore <rule>` directly under a
comment that gives the reason; a waiver without one fails the check.

An index on a large table (the usual case) is built by hand before the deploy, outside any transaction,
and the migration only records it:

1. In the migration (after `pnpm db:generate`, before it is applied anywhere), make the index statement
   idempotent and waive it:
   ```sql
   -- Built by hand with CREATE INDEX CONCURRENTLY before the deploy (docs/operations.md, "Migration safety").
   -- squawk-ignore require-concurrent-index-creation
   CREATE INDEX IF NOT EXISTS "post_body_idx" ON "post" USING btree ("body");
   ```
   Development, CI and small databases build it in the migration as usual.
2. Before the deploy, on production, run the same statement with `CONCURRENTLY` from `psql`:
   `CREATE INDEX CONCURRENTLY IF NOT EXISTS "post_body_idx" ON "post" USING btree ("body");`. It waits for
   running transactions and does not block writes.
3. Check that it is valid: `select indisvalid from pg_index where indexrelid = 'post_body_idx'::regclass;`.
   A failed concurrent build leaves an invalid index behind that `IF NOT EXISTS` would keep: drop it with
   `DROP INDEX CONCURRENTLY "post_body_idx";` and repeat step 2.
4. Deploy. The migration finds the index and does nothing.

Dropping an index works the same way with `DROP INDEX CONCURRENTLY IF EXISTS` and
`require-concurrent-index-deletion`.

Create the first account with `pnpm user:create <email> <name>` from a checkout of the repository with
its dependencies installed. The script loads the server's auth configuration, so `src/server/env.ts`
requires `DATABASE_URL`, `APP_URL` and `BETTER_AUTH_SECRET`; use the production values. It cannot run
from the Docker image, which contains only `.output/` and `drizzle/`. Accounts it creates have a verified
address and can sign in at once ([ADR 0003](decisions/0003-sign-up-policy.md)).

### Connection poolers

Managed Postgres often hands out two connection strings: a direct one and one through a pooler in
transaction mode (PgBouncer, Neon's `-pooler` host, Supabase's pooler on port 6543). In transaction mode
each transaction may run on a different server connection, so session state does not work: `SET`, session
advisory locks, `LISTEN` and SQL `PREPARE` ([PgBouncer's feature table](https://www.pgbouncer.org/features.html)).
PgBouncer also refuses startup parameters it does not track
([`ignore_startup_parameters`](https://www.pgbouncer.org/config.html#ignore_startup_parameters)), and Neon
recommends a direct connection for schema migrations.

- **The app** uses no session state: every query is a single statement or a Drizzle transaction, and pg
  uses unnamed protocol-level statements. It sends two startup parameters PgBouncer does not track:
  `statement_timeout` (15 s) and `idle_in_transaction_session_timeout` (30 s). With
  `DATABASE_URL_POOLED=true` it leaves both out; put them on the app's role instead, where every server
  connection the pooler opens picks them up (a pooler configured with `ignore_startup_parameters` would
  otherwise drop them silently):
  ```sql
  ALTER ROLE app_user SET statement_timeout = '15s';
  ALTER ROLE app_user SET idle_in_transaction_session_timeout = '30s';
  ```
  Do the same on a direct connection: the role setting also bounds a `psql` session as that role, and the
  startup parameters then only repeat it. Without the flag, every connection through PgBouncer fails with
  `unsupported startup parameter: statement_timeout`, and `/api/ready` answers 503.
- **Migrations** work through a transaction pooler (see step 2 above), but prefer a direct connection:
  set `MIGRATION_DATABASE_URL`. A migration that must run outside a transaction (`CREATE INDEX
  CONCURRENTLY`) is run by hand anyway ([Migration safety](#migration-safety)).
- **`user:create`** loads the app's database client, so it follows `DATABASE_URL` and
  `DATABASE_URL_POOLED` like the app.

`pnpm ci:docker` runs three migrators at once through PgBouncer 1.25 in transaction mode (two server
connections, the timeouts on the role), then serves the app through it
with `DATABASE_URL_POOLED=true`.

## Reverse proxy

Terminate TLS in the proxy and forward to the app over HTTP. The proxy must:

- preserve the `Host`, `Origin`, `Referer` and `Sec-Fetch-*` headers;
- not buffer or rewrite `Set-Cookie`;
- set or append the address it received the request from as the last `X-Forwarded-For` value (nginx
  `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for`; Caddy and Traefik do this by default), and
  reach the app from an address listed in `TRUSTED_PROXIES`.

For every method except GET, HEAD and OPTIONS, the app accepts request bodies up to 64 KiB (413 above
that, judged by `Content-Length`), answers 400 to a non-numeric `Content-Length`, and answers 411 to
chunked bodies (`Transfer-Encoding` without `Content-Length`). Proxies that buffer requests (nginx by
default) send a length.

### Edge proxy (Caddy)

`deploy/Caddyfile` is the reference edge, and the topology the tests measure: `pnpm lighthouse` always
runs through it, `pnpm verify:app --edge` optionally, and `pnpm ci:docker` serves the image behind it.
It uses Caddy 2.11.4 (image pinned by digest in `compose.yaml` and `scripts/images.ts`) and does four
things:

- **TLS and HTTP/2:** with a domain as `EDGE_ADDRESS` (`app.example.com`), Caddy obtains and renews the
  certificate, redirects HTTP to HTTPS (from `EDGE_HTTP_PORT`, default 80) and serves HTTP/2 and HTTP/3.
  `:8080` (the default) serves plain HTTP/1.1. Set `APP_URL` to the resulting origin. Browsers only speak
  HTTP/2 over TLS, so production pages always load over one multiplexed connection; see
  [Lighthouse through the edge](#lighthouse-through-the-edge).
- **Compression:** `encode zstd gzip` compresses what the app sends uncompressed: SSR HTML, API JSON.
  The build's precompressed `.br` assets already carry `Content-Encoding` and pass through unchanged, as
  do their `Cache-Control: public, max-age=31536000, immutable` headers. Nitro does not compress
  responses itself; compression is the edge's job.
- **No caching:** Caddy has no response cache. Nothing is stored, and `Cache-Control`, `ETag` and
  `Set-Cookie` reach the client as the app sent them, so `private` and `no-store` pages are never shared.
  `Host`, `Origin`, `Referer` and `Sec-Fetch-*` are forwarded as received.
- **Client IP:** Caddy resolves the client IP with its `trusted_proxies` rules and replaces the whole
  `X-Forwarded-For` with it (`header_up X-Forwarded-For {client_ip}`). Run the app with `TRUSTED_PROXIES`
  set to the edge's address (see [Client IP and rate limiting](#client-ip-and-rate-limiting)); the app
  then sees one client address followed by the edge. By default Caddy trusts no proxy: the TCP peer is
  the client, and an `X-Forwarded-For` sent by the client is replaced. If a load balancer or CDN sits in
  front of Caddy, list its ranges in `EDGE_TRUSTED_PROXIES` (space-separated CIDRs, or `private_ranges`);
  the app still trusts only Caddy. With `trusted_proxies_strict`, Caddy walks `X-Forwarded-For` from the
  right and takes the first address that is not trusted, so a client cannot pick its IP by prepending
  entries. The compose `edge` profile trusts the private ranges in the app, because Docker picks the
  network's subnet; local clients then arrive as the bridge gateway and share one rate-limit bucket.

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

### Lighthouse through the edge

`pnpm lighthouse` measures the topology users get: HTTPS with HTTP/2. `scripts/edge.ts` starts Caddy at
`https://localhost:<port>` with a certificate from Caddy's internal CA (`skip_install_trust` keeps that CA
out of the system trust store). The script trusts the CA for its own requests and hands Chrome
`--ignore-certificate-errors-spki-list=<hash>`: Chrome accepts exactly the key of that one certificate,
the page is a secure `https:` origin, and the best-practices audits see the same page as in production.
`--ignore-certificate-errors` would also do, but it accepts every certificate and marks the page as a
certificate error. Lighthouse starts each run with a fresh profile, so Chrome has not seen Caddy's
`Alt-Svc` yet and uses HTTP/2, as on a first visit; HTTP/3 is not measured.

The protocol matters for the mobile score. Lighthouse simulates a slow network (150 ms RTT, 1.6 Mbps)
from the requests of an unthrottled load. Over HTTP/1.1 every parallel request of the page (the stylesheet
and each preloaded script) opens a new connection in that simulation and pays its TCP (and TLS) handshake
and slow start; over HTTP/2 they share the warm connection of the document. Mobile medians of 3 runs,
same build, every page but `/dashboard` alike:

| Edge | FCP = LCP | Performance |
| --- | --- | --- |
| Plain HTTP/1.1 (`--edge-protocol=http`) | 1.95 s (`/dashboard` 2.10 s) | 98 (97) |
| HTTPS, HTTP/1.1 (`--edge-protocol=h1`) | 2.25 s (`/dashboard` 2.40 s) | 96 (95) |
| HTTPS, HTTP/2 (default) | 1.50 s (`/dashboard` 1.51 s) | 100 |

`--edge-protocol=h1|http` exist to compare; the gate uses HTTP/2. See
[ADR 0011](decisions/0011-lighthouse-over-https-http2.md) for why the remaining 1.5 s are the page's
JavaScript and what upstream changes would lower it.

### Client IP and rate limiting

The client IP keys the auth rate limits and is stored on each session (shown on the account page).
Better Auth resolves it from `X-Forwarded-For` with `advanced.ipAddress.trustedProxies`
(`src/server/auth.ts`). The only app code involved (`src/server/http/forwarded-for.ts`) appends the TCP
peer as the last hop of that header before Better Auth sees it, for `/api/auth/*` and for the server
functions alike.

An IPv6 client is recorded and rate-limited by its /64 network (`advanced.ipAddress.ipv6Subnet: 64`), not
by its full address: one subscriber usually gets a whole /64 and can pick any address in it, so per-address
buckets would let one client make unlimited fresh ones. Clients that share a /64 share a bucket. The
account page shows such a session's address as that network, for example `IPv6 network 2001:db8:1:2::/64`
(`::/64` for `::1`). IPv4 addresses are kept whole.

- **`TRUSTED_PROXIES` unset:** the TCP peer address is the client IP. Whatever `X-Forwarded-For` the
  client sent is dropped, so clients cannot choose their bucket. Use this only when clients connect to
  the Node process directly.
- **`TRUSTED_PROXIES` set:** Better Auth walks `X-Forwarded-For` from the right, skips every hop inside
  the listed ranges, and takes the first address outside them. Because the peer is the last hop, a client
  that reaches the Node process directly is itself that first address, whatever it sent. List your proxies
  exactly (their addresses, or the subnet they connect from), not a broad private range that also holds
  clients. With several proxy layers (a CDN in front of a load balancer), list all of them; each must
  append to the header. When every hop is trusted (for example the proxy's own health checks), there is
  no client IP and those requests share one bucket; Better Auth logs a warning once.

Behind a proxy without `TRUSTED_PROXIES`, every client appears with the proxy's address and shares one
bucket, so one attacker can block all sign-ins. Docker's port publishing on `127.0.0.1` behaves the same
way: local clients appear as the bridge gateway.

Limits (Better Auth, production build only): `/sign-in/*`, `/sign-up/*` and `/change-password` allow 3
requests per 10 seconds per IP; `/request-password-reset` and `/send-verification-email` 3 per minute;
other auth endpoints 100 per minute. `/get-session` is not limited. A limited request gets 429 with
`X-Retry-After` (the UI says how many seconds to wait). Server functions go through the same limits.

The counters live in the `rate_limit` table, so every instance shares them and restarts keep them. Each
request is one atomic `INSERT ... ON CONFLICT DO UPDATE` (`src/server/auth-rate-limit.ts`): Better Auth's
own database storage lets concurrent requests past the limit on Postgres (Drizzle adapter 1.7.6), so it is
replaced through `rateLimit.customStorage`. Rows idle for 10 minutes are deleted in the background.
Requests for endpoints outside the allowlist are not counted and write nothing.

The business API limits writes per user, not per IP, because with open sign-up anyone can hold a session:
creating, editing and deleting posts (`POST`, `PATCH` and `DELETE /api/me/posts`) count together against
60 per 60 seconds per account (`POST_WRITES_PER_WINDOW` in `src/contract/limits.ts`), in every build.
Past that they answer 429 with a `RateLimited` body whose `retryAfter` is the wait in seconds, as the
contract documents. The Effect middleware `WriteRateLimit` (`src/server/api/rate-limit.ts`) runs after
authentication and before the body is read, on the same table and upsert with keys `api-write|<user id>`.

## Accounts and mail

The sign-up policy is `AUTH_SIGN_UP` ([ADR 0003](decisions/0003-sign-up-policy.md)). In both modes an
account needs a verified address before its first session, and users can reset a forgotten password,
change it, list and end their sessions, and delete the account at `/account`.

| Mail | Sent when | Link |
| --- | --- | --- |
| Confirm your email address | Sign-up; a sign-in with the right password but an unverified address; `/verify-email` "send a new link" | `/verify-email?token=...`, valid 1 hour. The page confirms only when its "Confirm email" button is pressed (a POST), so mail scanners that follow links confirm nothing |
| Reset your password | `/forgot-password` | `/reset-password?token=...`, valid 1 hour, once. Setting the password ends every session |
| Someone tried to sign up with your email address | Sign-up with an address that already has an account | Links to `/login` and `/forgot-password` |

Answers never reveal whether an address has an account: sign-up, reset and "send a new link" answer the
same either way. Mail is sent after the response (`advanced.backgroundTasks`), so response times do not
either. On shutdown the server waits for pending mail before closing the SMTP transport.

Delivery goes through the `Mailer` interface in `src/server/mail/`: SMTP (Nodemailer, any provider) when
`SMTP_URL` is set, otherwise a log-only mailer. The log-only mailer writes a `mail not delivered` warning
per message; outside production it includes the recipient and the text with its link, in production only
the subject, because links carry tokens. `AUTH_SIGN_UP=open` refuses to start without `SMTP_URL`. With
`closed` and no SMTP, password reset mails reach nobody.

Locally, `pnpm mail:up` (also run by `pnpm bootstrap`) starts Mailpit from `compose.yaml`, pinned by
digest: SMTP on `MAILPIT_SMTP_PORT` (54325), the inbox and its API on `MAILPIT_HTTP_PORT` (54380). Nothing
leaves the machine. `pnpm verify:app` needs it: the E2E tests read links from its API.

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
its `close` hook, where the startup plugin (`src/server/nitro/startup.ts`) runs the shutdown steps one
after another, in this order: wait for pending background tasks (mail sends, bounded by the SMTP timeouts
of 5 s to connect and 15 s per socket operation, and rate-limit pruning, which queries Postgres), close
the mail transport, dispose the Effect runtime, end the Postgres pool. Server code registers each step
with `onShutdown` (`src/server/lifecycle.ts`), which does not import Nitro, so CLI scripts can load the
same modules. A failed step is logged (`shutdown cleanup failed`) and the next one still runs. The log
line `shutdown complete` lists the steps in the order they ran (`cleanups`, with each one's duration in
`steps`), and `verify:app` fails when it is missing, when `postgres-pool` is not among them, or when a
connection to the test database outlives the process.

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
- `server function failed`: a server function (`fn`, its name) threw something other than a redirect or
  not-found, whether the browser or SSR called it. The global function middleware
  (`src/lib/server-function-errors.ts`) logs the error and hands the caller `Error('Internal error')`
  instead, so no raw message reaches the browser; an SSR caller renders the route error page.
- `request error`: an error that reached Nitro's `error` hook from the request pipeline (`tags`,
  `method`, `path`). Nitro answers it with a bare JSON 500.
- `starting` and `shutdown complete` bracket the process lifetime. `starting` records `appUrl`,
  `trustedProxies`, `databasePoolMax` and `databaseUrlPooled`; `shutdown complete` lists the cleanups that ran (the Postgres
  pool, the Effect runtime, pending background tasks and the mailer).
- `shutdown cleanup failed`: a cleanup (`cleanup` field) rejected during shutdown.
- `uncaught exception, exiting` and `unhandled rejection`: see below.
- `postgres pool error`: an idle Postgres connection failed (for example, the database restarted).
- `background task failed`: work scheduled after a response (a mail send, Better Auth's cleanup) failed,
  for example because the SMTP server refused the message.
- `mail not delivered: SMTP_URL is unset`: `warn`, one per message. See [Accounts and mail](#accounts-and-mail).
- `Rate limiting could not determine a client IP ...` (`source: "better-auth"`): `warn`, once per process.
  See [Client IP](#client-ip-and-rate-limiting).

Logs never include headers, cookies, bodies or query strings. Error messages keep only their first
line, and stacks keep only their frames, because Drizzle and pg append SQL parameters (emails, session
tokens) on later lines. `tests/integration/db-failure.test.ts` breaks the database under a running server
and checks that neither the responses nor the log contain an email, password, session token or SQL
parameter.

Nothing patches `console`, so a few framework paths still print raw, multi-line text to stderr. None of
them carries request data beyond the URL path:

- h3 inside Start prints the error for a request Start cannot route, such as an unknown
  `/_serverFn/<id>` (the id is part of the path), until TanStack/router#8246 ships
  ([ADR 0009](decisions/0009-unknown-server-function-id.md)).
- Start prints `Server Fn Error!` for a server-function request that fails before the function runs,
  for example an unparsable payload.
- Nitro prints `[uncaughtException]` or `[unhandledRejection]` with the error before it calls the `error`
  hook, which then logs the JSON line. Such an error is a bug by definition; if it carried a Drizzle error,
  its parameters would be in that raw line.

After an uncaught exception the process logs it and exits with code 1 so the supervisor starts a clean
one (Nitro's `error` hook, tag `uncaughtException`, in `src/server/nitro/startup.ts`). Unhandled promise
rejections are logged and the process continues.

## Security settings

- **CSRF:** `src/start.ts` checks every request except GET, HEAD and OPTIONS to pages, server
  functions, `/api/*` and `/api/auth/*`. When `Sec-Fetch-Site` is present, it must be `same-origin`.
  Without it, the `Origin` header (or, if that is missing, the origin of `Referer`) must equal
  `APP_URL`. Anything else, including a request with none of these headers, gets 403 before
  authentication runs.
- **Auth endpoints:** `/api/auth/*` answers only `GET /get-session`, `POST /sign-in/email` and
  `POST /sign-out`: what a client without the UI needs to get, check and end the session cookie that the
  business API authenticates with. Session tokens are removed from their JSON bodies (the cookie carries
  the session). Every other path returns 404 before Better Auth runs. The account actions of the UI are
  server functions (`src/lib/auth.functions.ts`) that run Better Auth's router in-process, where the plugin
  in `src/server/http/auth-endpoints.ts` additionally allows `POST /sign-up/email` (with
  `AUTH_SIGN_UP=open` only), `POST /send-verification-email`, `GET /verify-email`,
  `POST /request-password-reset`, `POST /reset-password`, `POST /change-password`, `GET /list-sessions`,
  `POST /revoke-session`, `POST /revoke-other-sessions`, `POST /revoke-sessions` and `POST /delete-user`.
  Rate limits and the origin check apply on both paths. The server functions accept a narrower input than
  Better Auth: over raw HTTP, `/delete-user` would delete a fresh session's account without the password
  and `/list-sessions` would hand every session token to page scripts. A `hooks.before` in
  `src/server/auth.ts` also refuses `/delete-user` without a password, whoever calls it. The browser gets no
  session tokens (sessions are revoked by id). Signing in again does not revoke a session the browser
  already held; changing the password ends every other session, and resetting it ends all of them.
- **Server functions:** an error inside a server function reaches the browser only as
  `Error('Internal error')` (see [Logs](#logs)); expected account failures (wrong password, rate limit)
  are returned as values, not thrown. A request to `/_serverFn/<id>` with an unknown id gets Nitro's bare
  JSON 500 (`{"status":500,"unhandled":true,"message":"HTTPError"}`), without the id or a stack, until
  TanStack/router#8246 makes it a 404 ([ADR 0009](decisions/0009-unknown-server-function-id.md)).
- **Cookies:** `HttpOnly`, `SameSite=Lax`, `Path=/`, 7-day expiry, and `__Secure-` plus `Secure` over
  https.
- **Headers:** every response gets `X-Content-Type-Options`, `X-Frame-Options: DENY`,
  `Referrer-Policy`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`, `Permissions-Policy`,
  a Content-Security-Policy, and HSTS over https (`src/server/nitro/http.ts`).
- **CSP:** no policy allows `'unsafe-inline'` or `'unsafe-eval'`
  ([ADR 0010](decisions/0010-content-security-policy.md)). The directives live in
  `src/lib/content-security-policy.ts`.
  - SSR pages, including not-found and error pages: `getRouter` (`src/router.tsx`) creates a nonce per
    request, the router stamps it on every script, style and preload it renders, and the root route's
    `headers` sends `script-src 'self' 'nonce-…' 'strict-dynamic'` and `style-src 'self' 'nonce-…'`.
    `'strict-dynamic'` lets the nonced entry module load its imports and route chunks. Production only:
    in `pnpm dev`, Vite injects CSS as `<style>` tags without the nonce.
  - Prerendered pages (`/about`): Nitro's `prerender:generate` hook (`vite.config.ts`) hashes each inline
    script and style with sha256 (parsed with parse5) and writes `script-src 'self' 'sha256-…'` as a route
    rule header, which Nitro sends with the static file. An inline `style` or `on*` attribute fails the
    build, because no hash can allow it.
  - Everything else (JSON, public files, Nitro's error responses) gets
    `default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`
    (`src/server/nitro/http.ts`), which also appends `upgrade-insecure-requests` to document policies
    over https.
  - Every E2E test fails on a `securitypolicyviolation` event (`tests/e2e/fixtures.ts`), and
    `tests/integration/csp.test.ts` checks the headers of each kind of response.
- **Caching:** each response sets its own `Cache-Control`; the root route and the Nitro plugin never set
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
browsers, Postgres and (for `verify`) Mailpit, and moves artifacts. The logic lives in `scripts/ci-jobs.ts`:

| Script | Job |
| --- | --- |
| `pnpm ci:workflows` | actionlint 1.7.12 and zizmor 1.30.1 (images pinned by digest, offline, read-only), and a check that `compose.yaml`, `ci.yml` and the `Dockerfile` pin the same images as `scripts/images.ts`. Needs Docker. |
| `pnpm ci:secrets` | gitleaks 8.30.1 (image pinned by digest, offline, read-only) over every commit reachable from HEAD, with `.gitleaks.toml`. Needs Docker and a full clone (`fetch-depth: 0`). |
| `pnpm ci:static` | `pnpm check` without its drift gate (so with the migration lint and the license gate) |
| `pnpm ci:supply-chain` | `pnpm audit signatures` (registry signatures of every installed package) and `pnpm audit:check`. The frozen install before it already verified the lockfile against `minimumReleaseAge` and `trustPolicy`. Needs the npm registry. |
| `pnpm ci:drift` | `pnpm check:drift`, all four checks (`DATABASE_URL`) |
| `pnpm ci:build` | `pnpm build` with placeholder configuration (the same as the Dockerfile's) |
| `pnpm ci:verify` | `verify:app` on all five Playwright projects (needs Mailpit: the `mailpit` service) |
| `pnpm ci:lighthouse` | `pnpm lighthouse --runs=5`, through the edge. Exit 2 means inconclusive (see AGENTS.md) |
| `pnpm ci:docker` | `scripts/docker-smoke.ts`: builds the image, scans it with grype (see below), migrates with three runs at once through PgBouncer (transaction mode) and once directly, serves it through the pooler and behind Caddy on a private network, checks pages through the edge, stops it gracefully. Brings its own Postgres and PgBouncer. Needs Docker. |

`pnpm ci:local [job ...]` is the faithful local equivalent (default: every job, in CI order). It runs the
container jobs (`static`, `supply-chain`, `drift`, `build`, `verify`, `lighthouse`) in the official Playwright image
for `@playwright/test` 1.63.0 (Ubuntu 24.04, all browsers including WebKit), with Node from
`.node-version`, pnpm from `packageManager` and the pinned Caddy binary added, next to Postgres 18.6 and
Mailpit (`MAILPIT_HOST=mailpit` for `verify:app`) on a private Docker network. The host jobs (`workflows`, `secrets`, `docker`) drive Docker and run on the host.

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
The grype database volume (`<prefix>-grype-db`, about 200 MB) also stays between `ci:docker` runs.

## Supply chain

What guards the dependencies, the image and the repository, and where each gate runs:

| Gate | Runs in | Fails on |
| --- | --- | --- |
| pnpm policies (`pnpm-workspace.yaml`) | every `pnpm install --frozen-lockfile` (CI setup, Dockerfile) | a lockfile entry younger than `minimumReleaseAge` (one day, strict) or published with weaker provenance than an earlier version (`trustPolicy: no-downgrade`, for versions under 30 days old); an unmet peer (`strictPeerDependencies`); a dependency build script not listed in `allowBuilds` |
| `pnpm audit signatures` | CI `supply-chain` | a package whose registry signature does not verify |
| `pnpm audit:check` | CI `supply-chain` | a high or critical advisory in any package, production or development, not in `security/audit-allowlist.json`; an expired or stale allowlist entry |
| `pnpm licenses:check` | `pnpm check` | a production dependency whose license is not allowed (`scripts/licenses.ts`) |
| `pnpm check:migrations` | `pnpm check` | a migration statement that locks or rewrites a busy table ([Migration safety](#migration-safety)) |
| `pnpm ci:secrets` | CI `secrets`; the pre-commit hook when a `gitleaks` binary is installed | a secret anywhere in the history (`.gitleaks.toml`) |
| grype in `pnpm ci:docker` | CI `docker` | a high or critical vulnerability with a released fix in the production image, not in `security/image-allowlist.json` |

- **Allowlists.** Both files in `security/` take `{ <id>, package, reason, expires }`; the expiry is at most
  180 days ahead. A finding goes there only when it cannot apply here (the reason says why); the usual fix is
  an upgrade, an exact `overrides` entry in `pnpm-workspace.yaml` naming the advisory, or a newer base image.
- **Dependabot** proposes npm and GitHub Actions updates after a 7-day cooldown. It does not raise security
  alerts for this project: GitHub's dependency graph reads pnpm 12 lockfiles as empty
  (dependabot/dependabot-core#15904), so `pnpm audit:check` is the vulnerability gate. It does not update
  container images either (the docker ecosystems would change only some of the copies of a pin, see
  `.github/dependabot.yml`): `pnpm images:check` reports newer tags and rebuilt digests, and after editing
  `scripts/images.ts`, `pnpm images:sync` rewrites the copies. A grype failure in `ci:docker` is usually fixed
  by a rebuilt base image digest.
- **Runtime image.** Only `node`, `.output/` and `drizzle/`: the runtime stage deletes npm and npx, and the
  process runs as the unprivileged `node` user.
- **SBOM.** `pnpm sbom:release` writes CycloneDX documents for the production npm dependencies and for the
  whole image (syft) into `sbom/`, to attach to a release.
