# Operations

How to configure, deploy and run the app in production. The app is a single Node process
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
| `DATABASE_POOL_MAX` | no | Postgres connections per process, 1 to 100. Default 10. See [Connection math](#connection-math). |
| `DATABASE_URL_POOLED` | behind a pooler | `true` when `DATABASE_URL` is a connection pooler (PgBouncer, Neon's `-pooler` host, Supabase's pooler). Default `false`. See [Connection poolers](#connection-poolers). |
| `AUTH_SIGN_UP` | no | `closed` (default): accounts come from `pnpm user:create`. `open`: anyone can sign up at `/sign-up`; needs `SMTP_URL`. See [Accounts and mail](#accounts-and-mail). |
| `SMTP_URL` | for mail | `smtps://user:password@smtp.example.com:465` (TLS) or `smtp://...:587` (STARTTLS when offered); credentials percent-encoded. Unset: mail is only logged. |
| `MAIL_FROM` | with `SMTP_URL` | Sender, such as `Acme <no-reply@example.com>`. |
| `PORT`, `HOST` | no | Listen address. Default port 3000 on all interfaces. `NITRO_PORT` and `NITRO_HOST` take precedence when set. |
| `NITRO_SSL_CERT`, `NITRO_SSL_KEY` | no | Serve HTTPS from Node: PEM text or file paths. Both must be set; with only one, the server silently serves plain HTTP. File paths need an `--allow-fs-read` for each in the image's `CMD` ([ADR 0012](decisions/0012-node-permission-model.md)). |
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
docker build -t app .
```

`.output/` contains the server bundle, the public assets, and two operator commands bundled with their
dependencies by `scripts/bundle-cli.ts`: `migrate.mjs` (`scripts/migrate.ts`) and `create-user.mjs`
(`scripts/create-user.ts`). No `node_modules` are needed at runtime.

Three recipes put this sequence together: [one server with Docker Compose](#deploy-on-one-server-with-docker-compose)
(the simplest), [Fly.io](#deploy-on-flyio) and [Kubernetes](#deploy-on-kubernetes). Deploy sequence:

1. Build the image (or `pnpm build && node scripts/bundle-cli.ts` outside Docker).
2. Run the migrations once per deploy, before the new version receives traffic:
   ```sh
   docker run --rm -e DATABASE_URL=... app node .output/migrate.mjs
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
`excluded_paths`; every later one is linted. squawk comes from npm (`squawk-cli`, its platform binary as an
optional dependency), so it runs offline.

When a finding is expected, waive that one statement with `-- squawk-ignore <rule>` directly under a
comment that gives the reason; a waiver without one fails `tests/unit/repo-policy.test.ts`.

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

### First account

With the default `AUTH_SIGN_UP=closed`, accounts come from the operator. The image runs the bundled
command with the app's own environment (`DATABASE_URL`, `APP_URL`, `BETTER_AUTH_SECRET`, and
`DATABASE_URL_POOLED` behind a pooler). The password comes from `CREATE_USER_PASSWORD`, otherwise from
stdin: a hidden prompt, asked twice, with a terminal (`-it`), or the whole input of a pipe (`-i`):

```sh
docker run --rm -it --env-file app.env app node .output/create-user.mjs you@example.com "Your Name"
printf %s "$PASSWORD" | docker run --rm -i --env-file app.env app node .output/create-user.mjs you@example.com "Your Name"
```

Each deploy recipe below shows its form of the command. From a checkout, `pnpm user:create <email> <name>`
does the same. Accounts it creates have a verified address and can sign in at once
([ADR 0003](decisions/0003-sign-up-policy.md)); `pnpm ci:docker` creates one from the image and signs in
with it through the edge.

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
  `DATABASE_URL_POOLED` like the app, in the image too (`node .output/create-user.mjs`).

`pnpm ci:docker` runs three migrators at once through PgBouncer 1.25 in transaction mode (two server
connections, the timeouts on the role), then creates the first account and serves the app through it
with `DATABASE_URL_POOLED=true`.

## Deploy on one server with Docker Compose

The simplest production setup: one host with Docker, `deploy/compose.production.yaml` running Postgres, the
migrations (a one-shot service), the app and Caddy with automatic HTTPS. Every service has `restart: always`
and the data lives in named volumes. It needs a server with Docker Engine and the Compose plugin, a DNS
record for your domain pointing at it, and ports 80 and 443 (TCP, and UDP for HTTP/3) open.

1. On your machine, build and push an image with its own tag (a version or the commit, never `latest`):
   ```sh
   docker build -t "$APP_IMAGE" . && docker push "$APP_IMAGE"
   ```
2. Once, copy the recipe to a directory on the server and create its settings from the example
   (`$DEPLOY_HOST` is your `user@host`):
   ```sh
   ssh "$DEPLOY_HOST" mkdir -p app
   scp deploy/compose.production.yaml deploy/Caddyfile deploy/postgres-init.sh deploy/deploy.env.example "$DEPLOY_HOST":app/
   ssh "$DEPLOY_HOST" 'cd app && cp deploy.env.example deploy.env && chmod 600 deploy.env'
   ```
   Edit `deploy.env` there: `APP_IMAGE`, `DOMAIN`, the two database passwords and `BETTER_AUTH_SECRET`
   (generate them as its comments say), and SMTP. It is gitignored; keep it only on the server.
3. Deploy, and again for every new image (set its tag in `deploy.env` first):
   ```sh
   ssh "$DEPLOY_HOST" 'cd app && docker compose -f compose.production.yaml --env-file deploy.env pull && docker compose -f compose.production.yaml --env-file deploy.env up -d'
   ```
   `up -d` runs `migrate` to completion before it starts the new app container, and the app before Caddy.
   The old container stops before the new one starts, so each deploy has a few seconds of 502 from Caddy;
   use Fly.io or Kubernetes for rolling deploys.
4. Create the first account (a hidden prompt asks for the password):
   ```sh
   ssh -t "$DEPLOY_HOST" 'cd app && docker compose -f compose.production.yaml --env-file deploy.env run --rm --no-deps app node .output/create-user.mjs you@example.com "Your Name"'
   ```

On the first start, `postgres-init.sh` creates the role `app`, which owns the database but is not a
superuser, puts the statement and idle-transaction timeouts on it, and creates `pg_stat_statements`. The app
trusts `X-Forwarded-For` only from Caddy, at a fixed address on the stack's own network (`10.254.254.0/24`;
change both places if the host already routes that range). Logs: `docker compose ... logs -f app`. To roll
back, set the previous tag and run step 3; migrations stay applied, which is why each must be compatible
with the version before it ([Build and deploy](#build-and-deploy)).

CI tests this file on every change: `pnpm ci:docker` runs it with the override `compose.smoke.yaml` (the image
built from the checkout, PgBouncer in front of Postgres, plain HTTP on an ephemeral port, a subnet Docker
picks) through steps 3 and 4 and a sign-in through Caddy.

Tested locally with `DOMAIN=localhost`, where Caddy uses its internal CA, on ports 58080 and 58443: HTTPS
with HTTP/2 and the redirect from HTTP, the migrations, `create-user` through the command above, a sign-in
through Caddy (the session records the client's address, not Caddy's), the role's settings, and the backup
and restore drill below.

## Deploy on Fly.io

`deploy/fly.toml` builds the image from the `Dockerfile` and runs the migrations as the `release_command`,
once per deploy in a temporary machine, before the rolling update starts; a failed migration stops the
deploy. The health check is `/api/ready`, and `kill_timeout` (30 s) covers the drain and the shutdown steps.

1. `cp deploy/fly.toml fly.toml`, then set `app`, `primary_region` and `APP_URL`.
2. `fly launch --no-deploy` to create the app. Take Postgres from Fly, Neon or Supabase. With a pooled URL,
   set `DATABASE_URL_POOLED=true` and a direct `MIGRATION_DATABASE_URL` ([Connection poolers](#connection-poolers)).
3. `fly secrets set DATABASE_URL=... BETTER_AUTH_SECRET=... SMTP_URL=... MAIL_FROM=...`
4. `fly deploy`
5. First account: `fly ssh console --pty -C 'node .output/create-user.mjs you@example.com "Your Name"'`

Not deployed to Fly yet. Before relying on per-IP rate limits, check that `TRUSTED_PROXIES` in `fly.toml`
matches the addresses Fly's proxy connects from.

## Deploy on Kubernetes

`deploy/kubernetes.yaml` holds a Deployment (two replicas, rolling with no unavailable pod), a Service and a
PodDisruptionBudget; bring your own Ingress or Gateway for TLS. `pnpm ci:workflows` validates it with
kubeconform against the Kubernetes 1.33 schemas (strict: an unknown field fails). It has not been applied to
a cluster.

```sh
kubectl create secret generic app --from-literal=DATABASE_URL=... --from-literal=BETTER_AUTH_SECRET=...
kubectl apply -f deploy/kubernetes.yaml
kubectl exec -it deploy/app -c app -- node .output/create-user.mjs you@example.com "Your Name"
```

- **Migrations** run in an init container of every pod: concurrent runs queue on the advisory lock, and the
  later ones apply nothing. For long migrations, run them as a Job per release before rolling the
  Deployment instead.
- **Probes:** startup and liveness on `/api/health`, readiness on `/api/ready`. Liveness never checks the
  database.
- **Termination:** when a pod starts terminating, Kubernetes removes it from the Service's endpoints, but
  load balancers and kube-proxy notice at their own pace. The `preStop` sleep (5 s) keeps it serving
  meanwhile. Then SIGTERM starts the drain: `/api/ready` answers 503, responses close their connections,
  srvx waits up to `SERVER_SHUTDOWN_TIMEOUT` (5 s) for in-flight requests, and the shutdown steps finish
  pending mail and Better Auth work before the pool closes ([Shutdown](#shutdown)).
  `terminationGracePeriodSeconds` (35) covers all of it; after that, the kubelet sends SIGKILL.
- **Hardening:** non-root (`node`, uid 1000), no privilege escalation, every capability dropped, and a
  read-only root file system, which works because the server writes nothing (checked with
  `docker run --read-only --user 1000 --cap-drop ALL` on the image: migrations, pages, `/api/ready` and a
  clean stop).
- **Client IP:** set `TRUSTED_PROXIES` to the addresses your ingress controller's pods connect from, and make
  the controller append the client to `X-Forwarded-For`.

## Secrets

The secrets are `BETTER_AUTH_SECRET`, `DATABASE_URL` and `MIGRATION_DATABASE_URL` (they hold the database
password), `SMTP_URL` (its credentials) and, on the Compose recipe, the two database passwords. Keep them in
the platform's secret store: `deploy.env` with mode 600 on the server, `fly secrets`, a Kubernetes Secret
(with encryption at rest, or an external secrets operator). Never put them in the image (the Dockerfile's
build uses placeholders only), in `fly.toml`, in a manifest or in the repository. Anyone who can run
`docker inspect` or read the pod spec can read them, so treat that access as access to the secrets.
Rotating `BETTER_AUTH_SECRET` signs everyone out ([Rotating `BETTER_AUTH_SECRET`](#rotating-better_auth_secret)).
Rotating the database password: `ALTER ROLE app PASSWORD '...'`, update the secret, restart the app.

## Database operations

### Connection math

Each app process opens up to `DATABASE_POOL_MAX` connections (default 10). Postgres allows
`max_connections` (100 by default, 3 of them reserved for superusers; managed plans are often lower). Add
up everything that connects at the busiest moment:

```
replicas × DATABASE_POOL_MAX
+ surge during a rolling deploy (maxSurge × DATABASE_POOL_MAX)
+ 1 per migrator running (init containers start with the pods)
+ admin sessions, backups, other services
≤ max_connections − superuser_reserved_connections
```

Four replicas with the default pool and a surge of one need 50, plus a few: fine on 100. When the sum gets
close, lower `DATABASE_POOL_MAX` (a request holds a connection only for its queries), or put a pooler in
transaction mode in front ([Connection poolers](#connection-poolers)): then the pooler's own pool size is
what Postgres sees, and the app's pools only bound the clients. Autoscaling and serverless platforms need
the pooler.

### TLS to Postgres

The driver's connection-string parser (pg-connection-string 2.14) treats `sslmode=require`, `prefer` and
`verify-ca` as `verify-full` and warns once: the server certificate must chain to a trusted CA and match the
host. That works as is with providers whose certificates chain to a public CA. With a private CA (AWS RDS,
Google Cloud SQL, DigitalOcean and others), download the provider's CA bundle, put it in the image or a
volume, and name it in the URL (`sslrootcert=/path/ca.pem`); the driver reads that file when it connects, so
add `--allow-fs-read=/path/ca.pem` to the image's `CMD` as well
([ADR 0012](decisions/0012-node-permission-model.md)). `uselibpqcompat=true&sslmode=require` gives libpq's
meaning (encrypted, but no certificate check); avoid it outside a private network.

### Query statistics

`pg_stat_statements` is preloaded in both compose files. In production, `postgres-init.sh` creates the
extension; locally, run `create extension pg_stat_statements` once. Managed providers include it (enable
the extension in their console if needed). The slowest statements in total:

```sql
select calls, round(total_exec_time) as total_ms, round(mean_exec_time, 1) as mean_ms, query
from pg_stat_statements order by total_exec_time desc limit 20;
```

## Backups and restore

**Managed Postgres:** use the provider's point-in-time recovery (Neon's history retention, Supabase's PITR,
RDS automated backups), set the retention you need, and practice restoring to a new branch or instance.

**Self-hosted (the Compose recipe):** take a logical dump every night and copy it off the host, encrypted
(with restic, for example). A nightly dump loses up to a day; for point-in-time recovery, archive WAL with
pgBackRest or WAL-G to object storage.

```sh
docker compose -f compose.production.yaml --env-file deploy.env exec -T db \
  pg_dump -U postgres --format=custom --exclude-extension=pg_stat_statements app >"app-$(date +%F).dump"
```

`pg_stat_statements` stays out of the dump because only a superuser may create it, and the restore runs as
`app`; `postgres-init.sh` recreates it on a new server.

**Restore drill.** A backup counts only once it has been restored. Monthly, restore the latest dump into a
scratch database next to production, run the migrator against it (it must apply nothing), and look at the
data:

```sh
dc() { docker compose -f compose.production.yaml --env-file deploy.env "$@"; }
dc exec -T db psql -U postgres -c 'create database restore_drill owner app'
dc exec -T db pg_restore -U postgres --dbname=restore_drill --no-owner --role=app <app-2026-09-27.dump
dc exec -T db psql -U postgres -d restore_drill -c 'select count(*) from "user"'
. ./deploy.env && dc run --rm --no-deps -e "DATABASE_URL=postgres://app:$APP_DB_PASSWORD@db:5432/restore_drill" migrate
dc exec -T db psql -U postgres -c 'drop database restore_drill'
```

The same steps ran against the local test of the recipe. To restore for real, stop the
app (`dc stop app`), restore into a new database the same way, point `DATABASE_URL` at it (or rename the
databases), and start the app. Deleted accounts come back with a restore; see
[Data retention](#data-retention) for what that means for erasure.

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
the pinned image (`EDGE_RUNTIME=docker`, the default) or from a `caddy` binary (`EDGE_RUNTIME=binary`,
`CADDY_BIN`), which is what `pnpm ci:local` uses inside its container. The image runs on the host network
on Linux; on macOS and Windows, where Docker Desktop's host networking differs, it runs on Docker's bridge
network with its ports published on `127.0.0.1` and reaches the app at `host.docker.internal`
(`EDGE_DOCKER_NETWORK=host|bridge` overrides the choice). The app then trusts the private ranges as the
edge's address, because Docker picks them. The edge log goes next to the app log
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

The counters live in the `rate_limit` table, so every instance shares them. Each request is one atomic
`INSERT ... ON CONFLICT DO UPDATE` on its `key` (`src/server/auth-rate-limit.ts`): Better Auth's own database
storage lets concurrent requests past the limit on Postgres (Drizzle adapter 1.7.6), so it is replaced through
`rateLimit.customStorage`. Rows idle for 10 minutes are deleted in the background. Requests for endpoints
outside the allowlist are not counted and write nothing.

The table is `UNLOGGED`: its writes (one per rate-limited request) skip the WAL, and it is not replicated to
standbys. A clean Postgres restart keeps it; a crash or a failover empties it, which only lets every client
start a fresh window. Counters that last at most ten minutes are not worth the WAL traffic of durability.

The business API limits writes per user, not per IP, because with open sign-up anyone can hold a session:
creating, editing and deleting posts (`POST`, `PATCH` and `DELETE /api/me/posts`) count together against
60 per 60 seconds per account (`WRITES_PER_WINDOW` in `src/contract/limits.ts`), in every build.
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

## Data retention

What the database keeps about people, and for how long:

| Rows | Hold | Deleted |
| --- | --- | --- |
| `user`, `account`, `post` | Email, name, password hash, posts | With the account (`/account`, "Delete account"): `session`, `account` and `post` rows cascade |
| `session` | Client IP (IPv6 as its /64), user agent, times | On sign-out or revocation; a session expires 7 days after its last refresh, and the periodic cleanup deletes it 7 days after that |
| `verification` | Email-confirmation and password-reset tokens, keyed by the address or user | Once used; the periodic cleanup deletes expired ones (they are valid for 1 hour) |
| `rate_limit` | Client IP (auth limits) or user id (`api-write\|<id>`), a counter and a time | 10 minutes after the key's last request, when a later request prunes |

Better Auth (1.7.6) deletes an expired session only when its token is presented again, so without a
cleanup a user who never returns would leave their IP address and user agent behind indefinitely. Each
server process therefore runs `deleteExpiredAuthRows` (`src/server/auth-cleanup.ts`) every 10 minutes as
a background task: sessions that expired more than 7 days ago (`EXPIRED_SESSION_RETENTION_MS`, index
`session_expires_at_idx`) and expired verification tokens. It starts when the auth module loads (the first
request that reads a session) and stops at shutdown. `tests/db/auth-cleanup.test.ts` covers what it deletes
and keeps.

After an account is deleted, its unused verification tokens stay until they expire (at most an hour, then
the next cleanup) and its `rate_limit` rows until they are pruned. Backups keep everything for as long as
they are retained: that is the real erasure horizon, so state it in your privacy notice and keep backups no
longer than you need ([Backups and restore](#backups-and-restore)). Production logs hold no email addresses
or tokens ([Logs](#logs)), but request logs hold paths and times.

## Health checks

| Endpoint | Meaning | Use for |
| --- | --- | --- |
| `GET /api/health` | The process answers HTTP. No dependencies are checked. | Liveness, the Docker `HEALTHCHECK` (see below) |
| `GET /api/ready` | Postgres answers `select 1` and the process is not shutting down. Otherwise 503 with a JSON body carrying `"_tag":"ServiceUnavailable"` and `"message":"Database unavailable"` or `"Shutting down"`. | Readiness, load balancer routing |

Postgres connection attempts time out after 5 s, so `/api/ready` answers 503 within about 5 s even when
the database host does not respond. Do not use `/api/ready` for liveness: a database outage would restart
every instance without fixing anything.

The image's `HEALTHCHECK` fetches `/api/health` from inside the container over plain HTTP. It resolves
the address like the server does: `NITRO_PORT`, else `PORT`, else 3000; `NITRO_HOST`, else `HOST`, with
`127.0.0.1` when that is unset, `0.0.0.0` or `::`. If the server terminates TLS itself
(`NITRO_SSL_CERT` and `NITRO_SSL_KEY`), replace the probe.

## Shutdown

On SIGTERM or SIGINT the process logs `draining` and, from then on, `/api/ready` answers 503
(`Shutting down`) and every response carries `Connection: close`, so a load balancer stops routing here
and does not reuse a keep-alive connection. srvx (Nitro's HTTP server) stops accepting connections,
closes idle ones, waits for in-flight requests up to `SERVER_SHUTDOWN_TIMEOUT` seconds (default 5) and
then force-closes them. Nitro then runs its `close` hook, where the startup plugin
(`src/server/nitro/startup.ts`) runs the shutdown steps one after another, in this order: stop the
periodic auth cleanup, wait for pending background tasks (mail sends, bounded by the SMTP timeouts of 5 s
to connect and 15 s per socket operation; rate-limit pruning and a running cleanup pass; and Better Auth
requests whose client disconnected, see below), close the mail transport, dispose the Effect runtime, end
the Postgres pool. Server code registers each step with `onShutdown` (`src/server/lifecycle.ts`), which
does not import Nitro, so CLI scripts can load the same modules. A failed step is logged (`shutdown
cleanup failed`) and the next one still runs. The log line `shutdown complete` lists the steps in the
order they ran (`cleanups`, with each one's duration in `steps`).

srvx's drain waits for connections, not for the work behind them. When a client disconnects during a
sign-in, its response settles at once (logged as 499), but Better Auth goes on hashing the password and
then writes the session; a load test found such writes failing with `Failed query` after the pool had
closed. Every Better Auth call therefore counts as a background task until it finishes
(`finishBeforeShutdown`, `src/server/background-tasks.ts`).

`verify:app` stops its main server the hard way (`stopWhileDraining` in `scripts/app-server.ts`): a
request to `/api/ready` that arrives at the moment of SIGTERM must get 503 with `Connection: close`, and a
sign-in abandoned just before it must be logged as 499 before `shutdown complete`, with no failed query
after. It also fails when `shutdown complete` is missing or lacks `postgres-pool`, or when a connection to
the test database outlives the process.

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
  answer 400 or above. 5xx responses are logged at `error` level. A request whose client disconnected
  before the response is logged at `info` with `status: 499` and `aborted: true`, whatever the unsent
  response was (usually a 500 from the aborted body or render), so load-test endings and impatient
  clients do not trip 5xx alerts. The contract-coverage check ignores these lines.
- `draining`: SIGTERM or SIGINT arrived (`signal`); see [Shutdown](#shutdown).
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
  `trustedProxies`, `databasePoolMax`, `databaseUrlPooled` and `permissionModel`; `shutdown complete` lists the cleanups
  that ran (the auth cleanup timer, pending background tasks, the mailer, the Effect runtime and the
  Postgres pool).
- `expired auth rows deleted`: the periodic cleanup removed expired sessions or verification tokens
  (`sessions`, `verifications`: how many). See [Data retention](#data-retention).
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
| `pnpm ci:workflows` | actionlint 1.7.12 and zizmor 1.30.1 (images pinned by digest, offline, read-only), a check that `compose.yaml`, `deploy/compose.production.yaml`, `ci.yml` and the `Dockerfile` pin the same images as `scripts/images.ts`, and the deploy recipes (`docker compose config` on the production compose file, kubeconform 0.8.0 on `deploy/kubernetes.yaml`, which downloads the schemas). Needs Docker. |
| `pnpm ci:secrets` | gitleaks 8.30.1 (image pinned by digest, offline, read-only) over every commit reachable from HEAD, with `.gitleaks.toml`. A fake value in the tree follows that file's naming convention; `.gitleaksignore` lists, by fingerprint and with a reason, only findings in history that cannot be rewritten. Needs Docker and a full clone (`fetch-depth: 0`). |
| `pnpm ci:static` | `pnpm check` without its drift gate (so with the migration lint and the license gate) |
| `pnpm ci:supply-chain` | `pnpm audit signatures` (registry signatures of every installed package) and `pnpm audit:check`. The frozen install before it already verified the lockfile against `minimumReleaseAge` and `trustPolicy`. Needs the npm registry. |
| `pnpm ci:drift` | `pnpm check:drift`, all four checks (`DATABASE_URL`) |
| `pnpm ci:build` | `pnpm build` with placeholder configuration (the same as the Dockerfile's) |
| `pnpm ci:verify` | `verify:app` on all five Playwright projects (needs Mailpit: the `mailpit` service) |
| `pnpm ci:lighthouse` | `pnpm lighthouse --runs=5`, through the edge. Exit 2 means inconclusive (see docs/agents/gates.md) |
| `pnpm ci:docker` | `scripts/docker-smoke.ts` on the adopters' recipe itself: `deploy/compose.production.yaml` plus `compose.smoke.yaml` (PgBouncer in transaction mode in front of Postgres, the image built from this checkout, the edge on an ephemeral loopback port). Builds the image, scans it with grype (see below), migrates with three runs at once through the pooler and once directly, creates the first account with the bundled `create-user`, brings the stack up, checks pages and a sign-in through the edge, stops the app gracefully, and `down -v` removes everything. Needs Docker. |

`pnpm ci:local [job ...]` is the faithful local equivalent (default: every job, in CI order). The container jobs
(`static`, `supply-chain`, `drift`, `build`, `verify`, `lighthouse`) run in `compose.ci.yaml`: a `runner` built
from the official Playwright image for `@playwright/test` 1.63.0 (Ubuntu 24.04, all browsers including WebKit)
with pnpm from `packageManager` and the pinned Caddy binary, next to Postgres 18.6 and Mailpit
(`MAILPIT_HOST=mailpit`). pnpm installs the Node of `devEngines.runtime` there as it does everywhere. The host
jobs (`workflows`, `secrets`, `docker`) drive Docker themselves and run on the host.

- The runner never touches the host's `node_modules` or `.output`. Once per run, the script fills the `work`
  volume with what a CI checkout contains: a clone of HEAD and its parent (the static job diffs against
  `HEAD^`), with the files as they are on disk on top (tracked and untracked ones that are not ignored), then
  `pnpm install --frozen-lockfile`. The pnpm store is the volume `<prefix>-pnpm-store`, kept between runs.
- Each job is `docker compose run --rm runner pnpm ci:<job>` in a fresh container. Limits: `CI_LOCAL_CPUS`
  (default 4, like a GitHub-hosted runner), `CI_LOCAL_MEMORY` (default `6g`, no swap) and `CI_LOCAL_SHM`
  (default `2g`; Chrome needs a large `/dev/shm`). Postgres keeps its data in memory.
- `verify` and `lighthouse` add `build` when it is missing, like CI's `needs: build`. Jobs run one at a
  time; a Lighthouse run shares the machine with nothing else.
- Reports are copied to `test-results/ci-local/<job>/`. The summary lists every job's time and its
  container's peak memory, read inside the container (`/sys/fs/cgroup/memory.peak`, page cache included), so
  it works wherever Docker runs Linux containers.
- The compose project is `<prefix>-local-<pid>`; `docker compose down -v` removes its containers, network,
  image tag and `work` volume at the end, also on Ctrl-C. `CI_DOCKER_PREFIX` sets the prefix (default
  `<package name>-ci`).

`act` still works as a smoke test of the YAML for the jobs without artifacts, but not as a CI
replacement: `actions/upload-artifact` v7 fails under act (nektos/act#6022).
The grype database volume (`<prefix>-grype-db`, about 200 MB) also stays between `ci:docker` runs.

## Development platforms

The tooling targets Linux, macOS and Windows; CI runs everything on Linux and `pnpm check` on Windows
(`static-windows`, not blocking yet, on main and on demand).

- **Starting pnpm and tools.** On Windows, `pnpm`, `npm` and the files in `node_modules/.bin` are `.cmd`
  shims, which Node refuses to start without a shell (CVE-2024-27980). The scripts start them with
  [tinyexec](https://github.com/tinylibs/tinyexec)'s `xSync`, which puts `node_modules/.bin` first on PATH and,
  on Windows, resolves the command through PATHEXT and runs a shim through `cmd.exe` with every argument
  escaped (twice for `node_modules/.bin` shims, which re-parse them), as cross-spawn does.
- **Line endings.** `.gitattributes` keeps text files LF on every platform; with the CRLF that Git for
  Windows checks out by default, the format check would fail.
- **The pre-commit hook** is lefthook, a Go binary from npm; it runs each job through `sh`, which Git for
  Windows provides. The Windows path has not been run yet; `git commit --no-verify` skips the hook if it fails.
- **The edge** runs on the bridge network on macOS and Windows ([Edge proxy](#edge-proxy-caddy)). This
  path is written for Docker Desktop and has not been run there yet. On Linux it needs a host firewall that
  lets containers reach the host (it timed out on the maintainer's machine), which is why Linux keeps the
  host network by default.
- **`pnpm ci:local` and `pnpm ci:docker`** need Docker.

### Linux: memory caps

The type-aware lint, `pnpm build` (about 1.9 GB peak), `verify:app` and `lighthouse` are heavy. A
misconfigured lint once reached 17 GB and took a laptop down. On Linux, run heavy commands one at a time
under a cgroup limit, so a runaway process is killed alone:

```sh
systemd-run --user --scope -p MemoryMax=4G -p MemorySwapMax=0 -- pnpm build
```

On macOS and Windows, watch Activity Monitor or Task Manager, and give Docker Desktop a memory limit.

## Supply chain

What guards the dependencies, the image and the repository, and where each gate runs:

| Gate | Runs in | Fails on |
| --- | --- | --- |
| pnpm policies (`pnpm-workspace.yaml`) | every `pnpm install --frozen-lockfile` (CI setup, Dockerfile) | a lockfile entry younger than `minimumReleaseAge` (one day, strict) or published with weaker provenance than an earlier version (`trustPolicy: no-downgrade`, for versions under 30 days old); an unmet peer (`strictPeerDependencies`); a dependency build script not listed in `allowBuilds` |
| `pnpm audit signatures` | CI `supply-chain` | a package whose registry signature does not verify |
| `pnpm audit:check` | CI `supply-chain` | a high or critical advisory in any package, production or development, not in `auditConfig.ignoreGhsas` (`pnpm-workspace.yaml`) |
| `pnpm licenses:check` | `pnpm check` | a production dependency whose license is not allowed (`scripts/licenses.ts`) |
| `pnpm check:migrations` | `pnpm check` | a migration statement that locks or rewrites a busy table ([Migration safety](#migration-safety)) |
| `pnpm ci:secrets` | CI `secrets`; the pre-commit hook when a `gitleaks` binary is installed | a secret anywhere in the history (`.gitleaks.toml`) |
| grype in `pnpm ci:docker` | CI `docker` | a high or critical vulnerability with a released fix in the production image (`grype --only-fixed --fail-on high`), unless `.grype.yaml` ignores it |

- **Exceptions.** An advisory goes in `auditConfig.ignoreGhsas` (`pnpm-workspace.yaml`, with a comment giving the
  reason and a review date), and an image finding in `.grype.yaml` (an `ignore` rule with the package, a
  `reason` and a review date in it), only when it cannot apply here. The usual fix is an upgrade, an exact
  `overrides` entry in `pnpm-workspace.yaml` naming the advisory, or a newer base image.
- **Renovate** (`renovate.json`; install the Renovate GitHub App to turn it on) proposes updates for the npm
  packages, pnpm (`packageManager`), Node (`devEngines`), every container image and the GitHub Actions, the
  last two pinned by digest. An image pinned in several files (`scripts/images.ts`, the compose files, `ci.yml`,
  the Dockerfiles) moves in one PR. It waits 7 days after a release, except for a vulnerability fix: its OSV
  alerts (osv.dev) open that PR at once, since GitHub's dependency graph reads pnpm 12 lockfiles as empty
  (dependabot/dependabot-core#15904) and GitHub's own alerts miss this project. A grype failure in `ci:docker`
  is usually fixed by a rebuilt base image digest, which Renovate proposes.
- **Runtime image.** Only `node`, `.output/` and `drizzle/`: the runtime stage deletes npm and npx, and the
  process runs as the unprivileged `node` user, under Node's permission model: it may read `.output/` and
  use the network, and nothing else (no file writes, child processes, workers or addons;
  [ADR 0012](decisions/0012-node-permission-model.md)). The tests run the server with the same flags.
- **SBOM.** `pnpm sbom:release` runs pnpm's `pnpm sbom` and writes a CycloneDX document of the production npm
  dependencies (with their licenses) to `sbom/npm.cdx.json`, to attach to a release. Nothing publishes
  an image yet; a workflow that does should build it with `docker buildx build --sbom=true
  --provenance=mode=max`, which attaches the image's SBOM (OS packages included) and a SLSA provenance
  attestation to the pushed image.
