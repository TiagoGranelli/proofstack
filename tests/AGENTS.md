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
  next to `DATABASE_URL` (dropped afterwards; `KEEP_TEST_DB=1` keeps it). It needs Postgres, no build.
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

Each layer's harness and rules are in its folder: [api](api/AGENTS.md), [db](db/AGENTS.md),
[component](component/AGENTS.md), [e2e](e2e/AGENTS.md), and [integration](integration/AGENTS.md), which also
describes the running app both integration and E2E test. Claude Code loads the one for the folder you open.

- **Coverage.** `pnpm test:fast` writes `coverage/index.html` for all of `src` and fails unless every module in
  `COVERAGE_GATE` is fully covered (lines and branches) and the whole of `src` stays above `COVERAGE_FLOOR`, set
  a little under the measured totals. Add security-critical and fully tested modules to the gate with their
  tests; raise the floor when coverage grows.
- **Properties.** Parsers, validators and anything security-relevant get fast-check properties next to their
  examples (`import * as fc from 'fast-check'`): round trips, arbitrary input never throws, invariants such as
  "the TCP peer is the last hop" or "a returned redirect is accepted as it is". When a property finds a case,
  add it to the examples too, so the failure stays named.
- **Contract coverage.** After a full `verify:app`, `scripts/contract-coverage.ts` checks that every
  operation × status in `openapi.json` was answered by some test (the app servers' request logs, plus the
  api layer through the harness's recorder, `CONTRACT_OBSERVATIONS`) and that no operation answered a status it
  does not declare. A new declared status needs a test that provokes it; a gap that cannot be tested goes in
  `tests/contract-coverage-allowlist.json` with its reason (today: the CSRF 403 and the empty 500 of a defect,
  which the API description documents once). Stale entries fail.
- **Flakiness.** CI retries a failed Playwright test once but fails the run if it then passes
  (`failOnFlakyTests`): fix the cause. Locate fields by role and exact name (`getByRole('textbox', { name:
  'Email', exact: true })`); a bare `getByLabel('Email')` also matches "Email confirmed". Mutation testing is
  not a gate yet: StrykerJS's Vitest runner skips nested tests on Vitest 5
  ([docs/stack.md](../docs/stack.md#mutation-testing)).
