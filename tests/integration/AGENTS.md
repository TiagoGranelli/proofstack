# tests/integration/AGENTS.md

The running app, for the integration and E2E layers. [tests/AGENTS.md](../AGENTS.md) still applies.

- Each runner's global setup needs Mailpit (`pnpm mail:up`; `MAILPIT_SMTP_PORT`/`MAILPIT_HTTP_PORT` from
  `.env`) and starts two servers on one database per run: the open one with `AUTH_SIGN_UP=open` and loopback in
  `TRUSTED_PROXIES`, and the closed one with the default closed sign-up and a proxy list that excludes the
  test process. Integration tests reach them through `tests/integration/helpers.ts` (`appUrl`, `closedAppUrl`,
  `databaseUrl`, `sharedUsers`: `inject('servers')`), and `tests/integration/setup.ts` puts the open server's settings
  in each worker's environment for the server modules a test imports and for `scripts/create-user.ts`. E2E
  workers get `APP_URL` (Playwright's `baseURL`), `CLOSED_APP_URL`, `MAILPIT_URL` and the server settings as
  environment variables. Only `auth-client-ip.test.ts` signs in on the closed server: every request there
  shares the bucket of 127.0.0.1.
- A test that stops or breaks a server starts its own with `startApp` on its own database, as
  `db-failure.test.ts` (tables renamed under a running app) and `shutdown.test.ts` (SIGTERM while draining,
  the permission model, no connection left) do.
- Integration files run in parallel. A file that writes rows signs in as accounts of its own, from
  `createUser(label)` in a `beforeAll` (as `posts.test.ts`): what an author owns is then only what the file
  wrote. `sharedUsers` (two accounts every file sees) are for reading: sign-in, the session, `/api/me`.
- Each file creates its own client IP
  sequence with `clientIps('<prefix>')` from `tests/integration/helpers.ts` (for example `192.0.2`), sent
  as `X-Forwarded-For`, so each file has its own sign-in rate-limit buckets. Use a prefix no other file
  uses.
- `/api/auth/*` only signs in, signs out and reads the session. Account actions in integration tests go
  through the server functions over HTTP, `callAuthFunction(name, { data, headers })` from
  `tests/integration/server-functions.ts`, on an account from `createUser(label)`.
- The public list is shared by every file: assert there only on posts the test created.
- State-changing requests must send `Origin: <APP_URL>`. Without it, the CSRF middleware in
  `src/start.ts` answers 403 before authentication runs, so a test that expects 401 gets 403.
  `sdkClient(cookie)` and `postSignIn` send it; the anonymous `sdkClient()` does not.
- Optional environment for both runners and `verify:app` (`ALLOW_STALE_BUILD` also applies to `lighthouse`):
  - `KEEP_TEST_DB=1`: keep the per-run database after the run.
  - `ALLOW_STALE_BUILD=1`: skip the check that `.output` was built from the sources on disk (content hashes,
    `scripts/build-freshness.ts`; CI tests a downloaded build).
  - `TEST_EDGE=1`: put the Caddy edge (`deploy/Caddyfile`, `scripts/edge.ts`) in front of the open server; its
    log is `test-results/edge-<runner>.log`.
- Vitest skips its global teardown on Ctrl-C, and a killed run skips any teardown: the servers go with the
  terminal's signal, and the next run that creates a test database drops the ones whose pid is gone.
