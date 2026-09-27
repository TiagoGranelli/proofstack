# Operations

How to configure, deploy and run ProofStack in production. The app is a single Node process
(Nitro `node-server` output in `.output/`) in front of PostgreSQL.

## Environment

The server validates the variables read by `src/server/env.ts` while it starts (loaded by the Nitro
plugin `src/server/nitro/startup.ts`): `DATABASE_URL`, `APP_URL`, `BETTER_AUTH_SECRET`,
`TRUSTED_PROXIES`, `DATABASE_POOL_MAX`, `AUTH_SIGN_UP`, `SMTP_URL` and `MAIL_FROM`. An invalid value stops
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
| `AUTH_SIGN_UP` | no | `closed` (default): accounts come from `pnpm user:create`. `open`: anyone can sign up at `/sign-up`; needs `SMTP_URL`. See [Accounts and mail](#accounts-and-mail). |
| `SMTP_URL` | for mail | `smtps://user:password@smtp.example.com:465` (TLS) or `smtp://...:587` (STARTTLS when offered); credentials percent-encoded. Unset: mail is only logged. |
| `MAIL_FROM` | with `SMTP_URL` | Sender, such as `ProofStack <no-reply@example.com>`. |
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
from the Docker image, which contains only `.output/` and `drizzle/`. Accounts it creates have a verified
address and can sign in at once ([ADR 0003](decisions/0003-sign-up-policy.md)).

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

### Client IP and rate limiting

The client IP keys the auth rate limits and is stored on each session (shown on the account page).
Better Auth resolves it from `X-Forwarded-For` with `advanced.ipAddress.trustedProxies`
(`src/server/auth.ts`). The only app code involved (`src/server/http/forwarded-for.ts`) appends the TCP
peer as the last hop of that header before Better Auth sees it, for `/api/auth/*` and for the server
functions alike.

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

## Accounts and mail

The sign-up policy is `AUTH_SIGN_UP` ([ADR 0003](decisions/0003-sign-up-policy.md)). In both modes an
account needs a verified address before its first session, and users can reset a forgotten password,
change it, list and end their sessions, and delete the account at `/account`.

| Mail | Sent when | Link |
| --- | --- | --- |
| Confirm your email address | Sign-up; a sign-in with the right password but an unverified address; `/verify-email` "send a new link" | `/verify-email?token=...`, valid 1 hour |
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
its `close` hook (`src/server/nitro/shutdown.ts`), which ends the Postgres pool, disposes the Effect
runtime, and waits for pending background tasks (mail sends, bounded by the SMTP timeouts of 5 s to connect
and 15 s per socket operation) before closing the mail transport. The SSR bundle registers those cleanups through a registry on `globalThis`
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
  `trustedProxies` and `databasePoolMax`; `shutdown complete` lists the cleanups that ran (the Postgres
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
tokens) on later lines.

After an uncaught exception the process logs it and exits with code 1 so the supervisor starts a clean
one. Unhandled promise rejections are logged and the process continues.

## Security settings

- **CSRF:** `src/start.ts` checks every request except GET, HEAD and OPTIONS to pages, server
  functions, `/api/*` and `/api/auth/*`. When `Sec-Fetch-Site` is present, it must be `same-origin`.
  Without it, the `Origin` header (or, if that is missing, the origin of `Referer`) must equal
  `APP_URL`. Anything else, including a request with none of these headers, gets 403 before
  authentication runs.
- **Auth endpoints:** Better Auth answers only the endpoints the app uses (the plugin in
  `src/server/http/auth-endpoints.ts`): `GET /get-session`, `POST /sign-in/email`, `POST /sign-out`,
  `POST /sign-up/email` (with `AUTH_SIGN_UP=open` only), `POST /send-verification-email`,
  `GET /verify-email`, `POST /request-password-reset`, `POST /reset-password`, `POST /change-password`,
  `GET /list-sessions`, `POST /revoke-session`, `POST /revoke-other-sessions`, `POST /revoke-sessions` and
  `POST /delete-user`. Every other Better Auth endpoint returns 404. The UI reaches them through server
  functions (`src/lib/auth.functions.ts`) that run Better Auth's router in-process, so the allowlist,
  rate limits and origin check apply to both paths; the browser gets no session tokens (sessions are
  revoked by id). Signing in again does not revoke a session the browser already held; changing the
  password ends every other session, and resetting it ends all of them.
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
