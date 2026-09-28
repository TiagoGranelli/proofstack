# tests/AGENTS.md

The test manual. Read it before you write or change a test. The root `AGENTS.md` still applies.

Test each behavior in the cheapest layer that can observe it:

| Layer | Where | Run by | For |
| --- | --- | --- | --- |
| unit | `tests/unit` | `check` | Pure functions, examples plus fast-check properties. Modules in `COVERAGE_GATE` (`vitest.config.ts`) need 100% lines and branches |
| api | `tests/api` | `check` | Effect handler branching through the typed client: in-memory `PostsRepo`, fake session store, no database |
| component | `tests/component` | `check` | React components in Chromium (Vitest browser mode), network mocked by MSW: pending and disabled states, every error branch, limits, focus |
| db | `tests/db` | `test:db`, `verify:app` | Server modules on a real Postgres without a build: the rate-limit storage, and the query budget of every repository method |
| integration | `tests/integration` | `test`, `verify:app` | The built app over HTTP: SQL, Better Auth, CSRF, headers, rate limits, shutdown |
| e2e | `tests/e2e` | `test:e2e`, `verify:app` | Browser flows, axe on every page state, keyboard and focus, ARIA landmark snapshots |

Every new function is reached by a test in the cheapest layer that can observe it, and every bug fix adds a test
that fails without the fix. Fakes are named and defined once: a Layer in `tests/api/harness.ts`, a handler factory
in `tests/component/api-mocks.ts`, a module in `tests/component/stubs/`, a helper like `captureLog`
(`tests/unit/process-fakes.ts`); a test body does not stub a project module itself. A test body holds at most 15
statements (Oxlint `max-statements`; a `describe` has no length limit) and four nested callbacks.

## Running

- `pnpm test:unit|test:api|test:component [filter ...]` runs one fast layer; `pnpm test:fast` runs all three with
  coverage. `pnpm test:db [filter ...]` runs the `db` layer against a fresh `app_db_<pid>_test` database
  next to `DATABASE_URL` (dropped afterwards; `KEEP_TEST_DB=1` keeps it). It needs Postgres, no build. Creating
  any per-run database also drops those of runs whose pid is gone (stopped with Ctrl-C, killed).
- `pnpm test [filter ...]` (Vitest project `integration`) and `pnpm test:e2e [filter ...]` (Playwright) each
  start the built app themselves, after `pnpm build`, with Postgres and Mailpit (`pnpm mail:up`) running. Set no
  variables by hand: the runner's global setup (`tests/integration/global-setup.ts`, `tests/e2e/global-setup.ts`,
  both through `startTestServers` in `scripts/test-servers.ts`) refuses a stale `.output`, creates a fresh
  `app_<runner>_<pid>_test` database, starts the two servers described below with two verified authors, and
  stops them and drops the database at the end. App logs go to `test-results/app-server-<runner>*.log`. The
  same holds for `pnpm exec playwright test --ui` and the VS Code Playwright and Vitest extensions.
- `pnpm build && pnpm verify:app` runs, in order and each even after a failure, the api layer with its recorder,
  the `db` layer, the integration tests, the E2E tests (projects from `PW_PROJECTS`) and the contract-coverage
  check, then prints a summary. It takes no filter: for one layer or file, run that runner directly. The
  servers start once per runner.
- Install the test browsers once: `pnpm exec playwright install chromium firefox`. `verify:app`,
  `lighthouse` and the `component` project use `CHROME_PATH` instead of Playwright's Chromium when it is set.
  E2E runs every flow on the Playwright projects `chromium`, `firefox`, `webkit`, `Pixel 7` and `iPhone 15`;
  outside CI the default is `chromium,firefox`, because WebKit needs Ubuntu's libraries. `PW_PROJECTS=all`
  (or a list) chooses; `pnpm ci:local verify` runs all five.
- For a failed E2E run, open the trace: `pnpm exec playwright trace open test-results/<test>/trace.zip`
  (see [docs/agents/skills.md](../docs/agents/skills.md)).

## Rules per layer

- **Coverage.** `pnpm test:fast` writes `coverage/index.html` for all of `src` and fails unless every module in
  `COVERAGE_GATE` is fully covered (lines and branches) and the whole of `src` stays above `COVERAGE_FLOOR`, set
  a little under the measured totals. Add security-critical and fully tested modules to the gate with their
  tests; raise the floor when coverage grows.
- **Properties.** Parsers, validators and anything security-relevant get fast-check properties next to their
  examples (`import * as fc from 'fast-check'`): round trips, arbitrary input never throws, invariants such as
  "the TCP peer is the last hop" or "a returned redirect is accepted as it is". When a property finds a case,
  add it to the examples too, so the failure stays named.
- **api.** `tests/api/harness.ts`: `apiLayer({ databaseDown?, clockStepMicros? })` provides the real handlers,
  `RequestValidation` and `WriteRateLimit` over a fresh in-memory repository and rate-limit store (the Postgres
  store's rule on a virtual clock, one second per request, so `retryAfter` is computed, not a constant);
  `clientAs('alice' | 'bob' | 'forged' | 'none')` is a typed client with that session (one client per identity:
  the client captures its middleware). The typed client refuses to encode invalid payloads, so send those
  through `webHandler(options?)` as raw `Request`s. `database-down.test.ts` sends every contract operation with
  the database down and expects its documented failure, and `public-operations.test.ts` sends each one without a
  session and expects 401 unless `PUBLIC_OPERATIONS` lists it, so a new endpoint is checked without edits.
  The project sets dummy env values (`vitest.config.ts`) because `src/server/env.ts` validates at import;
  nothing connects to them.
- **db.** `tests/db` runs against a real, migrated database of its own (`tests/db/global-setup.ts`). A new
  repository method gets a query budget in its feature's `tests/db/<feature>-query-budget.test.ts` (as
  `posts-query-budget.test.ts`; shared services in `query-budget.test.ts`): `withBudget(name, n, effect)`
  (`tests/db/helpers.ts`) counts the statements an Effect built on `recordingDatabase` sends, and a list method
  must send as many for 1 row as for 50 (N+1 fails with the statements listed). A server path that reads rows
  through Better Auth is counted at pg's `Client` with `statementsOf` (tests/db/helpers.ts).
- **Contract coverage.** After a full `verify:app`, `scripts/contract-coverage.ts` checks that every
  operation × status in `openapi.json` was answered by some test (the app servers' request logs, plus the
  api layer through the harness's recorder, `CONTRACT_OBSERVATIONS`) and that no operation answered a status it
  does not declare. A new declared status needs a test that provokes it; a gap that cannot be tested goes in
  `tests/contract-coverage-allowlist.json` with its reason (today: the CSRF 403 and the empty 500 of a defect,
  which the API description documents once). Stale entries fail.
- **component.** Render with `renderInApp(ui, { url })` from `tests/component/test-utils.tsx` (memory
  router with the app's paths, fresh `QueryClient`; returns `router` and `queryClient`); `route: { path,
  route }` mounts a real `src/routes` file route there (search validation, loader, component). Mock the
  network per test with `worker.use(...)` from `tests/component/api-mocks.ts`: `api.<operation>({ body })`
  (handlers generated from `openapi.json` by Hey API's `msw` plugin into `src/sdk/msw.gen.ts`),
  `apiError(operation, status, body)` (only statuses and bodies the operation declares), `apiFailure`
  (network error or non-JSON body), `held()` (a response that waits, for pending states), and
  `authFunction(name, answer)` with the shortcuts `auth.signIn`/`auth.signOut` for the account server
  functions (outside the contract; `answer` is their typed `AuthOutcome`, `'network'`, `'thrown'` or
  `held()`, or `{ ...held(), answer }` to fail after release); `authCalls(name)` records the `data` each call
  sends. A button whose action is pending is `aria-disabled` and ignores presses, never `disabled` (a disabled
  button loses focus when the browser renders); `pressAndKeepFocus(button)` (test-utils.tsx) presses it with
  the keyboard and checks focus stays after two rendered frames. A test that starts a request must wait for its
  handler (for example `authCalls`) before it ends. A request to `/api` or `/_serverFn`
  without a handler fails the test. `#/lib/api-client.ts` is aliased to its browser branch
  (`tests/component/stubs/api-client.ts`), and `#/lib/auth.functions.ts` to a stub that posts each call to
  `/_serverFn/auth/<name>` (`tests/component/stubs/auth-functions.ts`).
- **Accessibility.** `expectAccessible(page, '<state>')` (`tests/e2e/support/a11y.ts`) fails on any axe
  violation of WCAG 2.0/2.1/2.2 A and AA or best practices. A new page or UI state is one entry in `STATES`
  in `tests/e2e/a11y.spec.ts`, a landmark snapshot in `tests/e2e/landmarks.spec.ts`, and, if it has controls, a row
  in the tab-order table of `tests/e2e/keyboard.spec.ts` (`tests/unit/route-coverage.test.ts` fails for a page
  route without all three; it recognizes `visit(page, '/path')` and the helpers listed in
  `scripts/route-coverage.ts`). `tabOrder` records every Tab stop, its accessible name and visible focus, and
  fails on a focus trap: `tabThrough` walks until a temporary sentinel after the last control, because what a
  browser does past the last control differs by engine.
  `navigateWithApiResponse(page, '/api/posts' | '/api/me/posts', response)` (`tests/e2e/support/app.ts`)
  reaches empty and failure states by answering the browser's API call on a client-side navigation; build
  list bodies with `lastPage(...)` so they match the contract's `PostPage`.
- **Flakiness.** CI retries a failed Playwright test once but fails the run if it then passes
  (`failOnFlakyTests`): fix the cause. Locate fields by role and exact name (`getByRole('textbox', { name:
  'Email', exact: true })`); a bare `getByLabel('Email')` also matches "Email confirmed". Mutation testing is
  not a gate yet: StrykerJS's Vitest runner skips nested tests on Vitest 5 (docs/plan.md, "Mutation testing").
- **E2E hydration and CSP.** Wait for `body[data-hydrated="true"]` before interacting: input before hydration
  is lost. Import `test` and `expect` from `tests/e2e/fixtures.ts`, not `@playwright/test`: it fails the test
  on any Content-Security-Policy violation.
- **E2E isolation.** Specs run in parallel on one database and never depend on each other's data. Import
  `test` from `tests/e2e/support/app.ts`: every worker gets its own `author` (created verified through
  `scripts/create-user.ts`) and every browser and API context its own client IP (sign-in rate limit).
  Flows that change or delete an account use a throwaway one instead: `createAccount` from
  `tests/e2e/support/accounts.ts` (created verified the same way), and a
  second signed-in browser comes from `newClient`, which gets its own client IP too.
  Find your posts by a unique body. Data several specs need is written once by the `seed` project
  (`tests/e2e/seed.setup.ts`), which runs before the browser projects; today that is more than a page of
  posts by an author only `posts-pagination.spec.ts` reads (`PAGINATED_AUTHOR`). Never publish many posts
  from a spec: a post published moments ago must stay on the first page of `/`.

## The running app (integration and E2E)

- Each runner's global setup needs Mailpit (`pnpm mail:up`; `MAILPIT_SMTP_PORT`/`MAILPIT_HTTP_PORT` from
  `.env`) and starts two servers on one database per run: the open one with `AUTH_SIGN_UP=open` and loopback in
  `TRUSTED_PROXIES`, and the closed one with the default closed sign-up and a proxy list that excludes the
  test process. Integration tests reach them through `tests/integration/helpers.ts` (`appUrl`, `closedAppUrl`,
  `databaseUrl`, `users`: `inject('servers')`), and `tests/integration/setup.ts` puts the open server's settings
  in each worker's environment for the server modules a test imports and for `scripts/create-user.ts`. E2E
  workers get `APP_URL` (Playwright's `baseURL`), `CLOSED_APP_URL`, `MAILPIT_URL` and the server settings as
  environment variables. Only `auth-client-ip.test.ts` signs in on the closed server: every request there
  shares the bucket of 127.0.0.1.
- A test that stops or breaks a server starts its own with `startApp` on its own database, as
  `db-failure.test.ts` (tables renamed under a running app) and `shutdown.test.ts` (SIGTERM while draining,
  the permission model, no connection left) do.
- Integration files run in parallel against the same two test users. Each file creates its own client IP
  sequence with `clientIps('<prefix>')` from `tests/integration/helpers.ts` (for example `192.0.2`), sent
  as `X-Forwarded-For`, so each file has its own sign-in rate-limit buckets. Use a prefix no other file
  uses.
- `/api/auth/*` only signs in, signs out and reads the session. Account actions in integration tests go
  through the server functions over HTTP, `callAuthFunction(name, { data, headers })` from
  `tests/integration/server-functions.ts`, on a throwaway account from `createUser(label)` (helpers.ts) when
  the test changes or deletes it.
- Assert only on posts the test created. An invariant over all of one author's posts (for example, an
  empty list) must be owned by a single file, because other files add posts for the same author
  concurrently.
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
