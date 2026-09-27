# AGENTS.md

ProofStack is a full-stack template built around a verifiable API contract. `src/contract` generates
`openapi.json`, which generates `src/sdk`; the running API and the tests must agree with all three. A
change is done when `pnpm check` passes, plus `pnpm check:drift` and `pnpm build && pnpm verify:app` for
changes to the contract, database, auth, or UI flows.

## Architecture map

| Path | Role | May import |
| --- | --- | --- |
| `src/contract/` | Effect `HttpApi` contract: schemas, endpoints, tagged errors, middleware tags | `effect` and other `src/contract` modules only |
| `src/server/` | Server-only: Effect handlers (`api/`), Better Auth (`auth.ts`), Drizzle (`db/`), repositories, `env.ts`, shutdown `lifecycle.ts` | contract, sdk |
| `src/sdk/` | Hey API client and TanStack Query options (generated) | nothing |
| `src/lib/` | Shared plumbing: `api-client.ts` (isomorphic SDK client), `api-error.ts`, `utils.ts`. `*.functions.ts` are server functions (`createServerFn`): `session.functions.ts` (route guards), `auth.functions.ts` (every account action) | contract, sdk. The server adapters (`*.functions.ts`, `api-client.ts`) also import server and lib |
| `src/components/` | Shared UI that knows no feature: `ui/` (shadcn primitives, Radix, style `radix-nova`), `errors/` (router error and not-found states, `ApiErrorAlert`), `layouts/` (site header, pending state) | lib, contract, sdk |
| `src/features/<name>/` | One feature each (`posts`, `auth`): `api/` (query options and mutation hooks), `components/`, `utils/` | components, lib, server adapters, contract, sdk. Never another feature |
| `src/routes/`, `router.tsx`, `start.ts`, `styles/` | The app layer. Page routes define the route (loader, guards, head) and compose features. `api/$.ts` hands requests to the Effect API; `api/auth/$.ts` to Better Auth | Page routes: features, components, lib, server adapters, contract, sdk. `api/**` is a server adapter: server, contract, sdk, lib |

- Every module in `src/server/` starts with `import '@tanstack/react-start/server-only'`. The exceptions
  are `nitro/` plugins and `db/schema/`, which drizzle-kit and Better Auth's CLI load outside Start.
- UI and page routes reach data only through the SDK (`#/sdk/...`) or a server function in
  `#/lib/*.functions.ts`. They never import `src/server`, `drizzle-orm`, `pg`, or `better-auth` (its client
  included) directly: account actions are server functions that run Better Auth's router in-process
  (`callAuthEndpoint` in `src/server/http/auth-handler.ts`), so rate limits and the endpoint allowlist apply.
  Only the server adapters import `src/server`: `src/routes/api/**`, `src/lib/*.functions.ts`,
  `src/lib/api-client.ts` and `src/lib/server-function-errors.ts`, the global function middleware
  (Fallow zone `server-adapters`).
- SSR loaders call the same SDK. On the server it dispatches in-process to the Effect handler
  (`src/server/api/in-process-client.ts`), so every business operation goes through the contract.
- Authorization happens in the Effect `Authentication` middleware. The `_authed` route guard is only a UX
  redirect.
- Boundaries are enforced by Fallow zones in `.fallowrc.json` and by `no-restricted-imports` in
  `.oxlintrc.json`. A new top-level `src/` directory needs a zone before it can be used.
- Imports use the `#/` alias (`package.json#imports`) with explicit `.ts` or `.tsx` extensions.

### Frontend structure

The UI follows [Bulletproof React](https://github.com/alan2207/bulletproof-react), with TanStack Start's
`src/routes/` as the app layer.

- Imports flow one way: `components` → `features` → app (`routes/`). A feature never imports another
  feature, not even `import type` (Fallow `autoDiscover` makes each `src/features/<name>` its own zone).
  When two features need the same code, move it down to `components/` or `lib/`; when a page needs two
  features, compose them in the route.
- Where new code goes:
  - Data access for a feature: `features/<name>/api/<verb>-<noun>.ts`. Queries export
    `get<Noun>QueryOptions()` bound to `client: apiClient()` over `#/sdk/@tanstack/react-query.gen.ts`.
    Mutations export a `use<Verb><Noun>({ mutationConfig })` hook that owns cache updates and invalidation
    and runs the caller's `onSuccess` before invalidating. Components never spread a generated
    `*Mutation()` themselves. Cache helpers shared by a feature's hooks go in `api/<noun>-cache.ts`.
  - Feature UI: `features/<name>/components/`; pure helpers: `features/<name>/utils/`.
  - UI shared by several features and free of feature knowledge: `components/` (`ui/`, `errors/`,
    `layouts/`). shadcn primitives go in `components/ui/` through `pnpm exec shadcn add`.
  - Route files hold the route definition (loader, `beforeLoad`, `head`, `headers`, `validateSearch`) and a
    small page component that composes features. Forms, buttons with behavior and lists live in features.
- Naming: files and folders are kebab-case (Oxlint `unicorn/filename-case`; folders by the `guards` gate
  in `scripts/check.ts`). TanStack route names keep their prefixes (`__root.tsx`, `_authed.tsx`, `$.ts`,
  `-private/`, `(group)/`). `src/sdk/` is generated and exempt.
- No barrel files (`index.ts` re-exporting a folder): import the file that defines the symbol (Oxlint
  `oxc/no-barrel-file`). The only exception is `src/server/db/schema/index.ts`, Drizzle's schema entry.

## Workflows

**API change.** Edit `src/contract/*` and `src/server/api/handlers.ts`. Run `pnpm codegen` to regenerate
`openapi.json` and `src/sdk/`. Commit all three together. `pnpm check:drift contract` must pass.

**Database change.** Edit `src/server/db/schema/*.ts`. Run `pnpm db:generate --name <slug>`, review the new
SQL in `drizzle/` (a type change that must convert data gets its `USING` clause there, as in
`0004_auth_timestamptz.sql`), apply it with `pnpm db:migrate` (after `pnpm db:up`), and run
`pnpm check:drift migrations`.

**Feature checklist.** A new feature usually touches every layer, in this order:

1. Schema in `src/server/db/schema/`, then `pnpm db:generate --name <slug>` and `pnpm db:migrate`.
2. Contract in `src/contract/`: schemas, endpoints, tagged errors. Constants the UI also needs (limits,
   lengths) go in `src/contract/limits.ts`, which stays free of Effect so client bundles do not pull in
   the schema runtime.
3. Repository (for example `src/server/posts/repo.ts`) and handler in `src/server/api/handlers.ts`.
4. `pnpm codegen`.
5. Map every new error tag to a message in `src/lib/api-error.ts`. Its error union is derived from the
   generated SDK, so `pnpm typecheck` fails until the switch in `describeApiError` handles the new tag.
6. UI in `src/features/<name>/` (see [Frontend structure](#frontend-structure)) and routes in `src/routes/`.
7. Tests, cheapest layer first (see [Tests](#tests)): handler branches in `tests/api/`, UI states in
   `tests/component/`, then `tests/integration/` and `tests/e2e/` (each new page or UI state gets an entry
   in `STATES` in `tests/e2e/a11y.spec.ts`).

**Auth config change** (plugins, user fields, rate-limit storage). `src/server/db/schema/auth.ts` is
application code: edit it by hand (timestamps stay `timestamptz`), then follow the database workflow.
`pnpm auth:check` (Better Auth's `auth check schema`, also run by `pnpm check`) fails until every table,
column, nullability and default the configuration writes exists. To see what Better Auth would generate, run
`pnpm exec auth generate --config src/server/auth.ts --output /tmp/auth-schema.ts -y` and port the
difference; never write its output over `auth.ts`.

**Users.** Run `pnpm user:create <email> <name>`. The password comes from `PROOFSTACK_USER_PASSWORD`,
otherwise from stdin: a hidden prompt (asked twice) in a terminal, or the whole input of a pipe. The account
is created verified. Public sign-up is `AUTH_SIGN_UP=closed` by default
([ADR 0003](docs/decisions/0003-sign-up-policy.md)).

**Auth endpoint.** A new account action is a server function in `src/lib/auth.functions.ts` calling
`callAuthEndpoint`, plus its `METHOD /path` in the allowlist (`src/server/http/auth-endpoints.ts`), a hook in
`src/features/auth/api/`, and a message for any new Better Auth error code in
`src/features/auth/utils/describe-auth-failure.ts`. Mail goes through `authMail` (`src/server/mail/`).

**First setup.** Run `pnpm install && pnpm bootstrap`. This creates `.env` with a secret, starts
Postgres and Mailpit (`pnpm mail:up`, the local inbox for account emails), and applies migrations.

## Verify

| Command | Covers |
| --- | --- |
| `pnpm check` | `format:check`, `lint` (warnings are counted in the summary but do not fail), `typecheck`, `deadcode`, `tests` (`pnpm test:fast`: Vitest projects `unit`, `api` and `component` with the coverage gate, see [Tests](#tests)), the database-free drift checks (contract, migrations, auth) and repo guards (including kebab-case folder names). No database, no build, about 9 s. Needs Playwright's Chromium. Run it before every hand-off. |
| `pnpm test:unit\|test:api\|test:component [filter ...]` | One fast layer (see [Tests](#tests)); `pnpm test:fast` runs all three with coverage |
| `pnpm format`, `pnpm lint:fix` | Autofixes |
| `pnpm check:drift [contract\|migrations\|auth\|database]` | Checks that generated files match their sources and that the auth schema holds what Better Auth writes; `database` needs Postgres |
| `pnpm build && pnpm verify:app [--no-e2e] [--no-integration] [--edge] [filter ...]` | Starts two built servers (open and closed sign-up) against a fresh per-run `proofstack_<purpose>_<pid>_test` database (dropped afterwards) and runs Vitest (`tests/integration`) and Playwright (`tests/e2e`, projects from `PW_PROJECTS`); app logs go to `test-results/app-server*.log`. Needs Mailpit (`pnpm mail:up`). `--edge` puts the Caddy edge in front of the open one. Refuses a stale `.output` |
| `pnpm build && pnpm lighthouse [--runs=3] [--page=<name>] [--form-factor=mobile\|desktop] [--direct]` | Lighthouse gate on the built app behind the Caddy edge (needs Docker); see the policy below |
| `pnpm ci:local [job ...]` | The CI jobs (`workflows static drift build verify lighthouse docker`, default all) as `pnpm ci:<job>` scripts in the Playwright Ubuntu container next to Postgres and Mailpit, all five browser projects included. Needs Docker. See [docs/operations.md](docs/operations.md#ci-and-local-ci) |

`pnpm test` (Vitest project `integration`) and `pnpm test:e2e` expect an app that is already running at
`APP_URL`; both also need `CLOSED_APP_URL` and `MAILPIT_URL`, the integration tests `TEST_USER_*`, and E2E
the app's own environment (`DATABASE_URL` and the rest, to create its authors). `verify:app` provides all
of it.

**Lighthouse policy** (`POLICY` in `scripts/lighthouse.ts`): per page and form factor, accessibility, best
practices and SEO must score 100 on every run; performance needs a median of at least 99, at most one run
below 100 and none below 95; the median metrics must stay within the budgets. `agentic-browsing` is
reported but not gated. SEO is not gated on `/login` and `/dashboard` (noindex). Exit 2 means
inconclusive, not failed: a run's `benchmarkIndex` was below 1000 or Lighthouse warned about a slow CPU
(each run's value and warnings are in `lighthouse-report/summary.json`). CI runs `pnpm lighthouse --runs=5`.

## Tests

Test each behavior in the cheapest layer that can observe it:

| Layer | Where | Run by | For |
| --- | --- | --- | --- |
| unit | `tests/unit` | `check` | Pure functions. Modules in `COVERAGE_GATE` (`vitest.config.ts`) need 100% lines and branches |
| api | `tests/api` | `check` | Effect handler branching through `HttpApiTest`: in-memory `PostsRepo`, fake session store, no database |
| component | `tests/component` | `check` | React components in Chromium (Vitest browser mode), network mocked by MSW: pending and disabled states, every error branch, limits, focus |
| integration | `tests/integration` | `verify:app` | The built app over HTTP: SQL, Better Auth, CSRF, headers, rate limits |
| e2e | `tests/e2e` | `verify:app` | Browser flows, axe on every page state, keyboard and focus, ARIA landmark snapshots |

- Install the test browsers once: `pnpm exec playwright install chromium firefox`. `verify:app`,
  `lighthouse` and the `component` project use `CHROME_PATH` instead of Playwright's Chromium when it is set.
  E2E runs every flow on the Playwright projects `chromium`, `firefox`, `webkit`, `Pixel 7` and `iPhone 15`;
  outside CI the default is `chromium,firefox`, because WebKit needs Ubuntu's libraries. `PW_PROJECTS=all`
  (or a list) chooses; `pnpm ci:local verify` runs all five.
- **Coverage.** `pnpm test:fast` writes `coverage/index.html` for all of `src` (report only) and fails unless
  every module in `COVERAGE_GATE` is fully covered. Add security-critical pure modules there with their tests.
- **api.** `tests/api/harness.ts`: `apiLayer({ databaseDown?, clockStepMicros? })` provides the real handlers and
  `RequestValidation` over a fresh in-memory repository; `clientAs('alice' | 'bob' | 'forged' | 'none')`
  is a typed client with that session (one client per identity: the client captures its middleware).
  The typed client refuses to encode invalid payloads, so send those through `webHandler()` as raw
  `Request`s. The project sets dummy env values (`vitest.config.ts`) because `src/server/env.ts` validates
  at import; nothing connects to them.
- **component.** Render with `renderInApp(ui, { url })` from `tests/component/test-utils.tsx` (memory
  router with the app's paths, fresh `QueryClient`; returns `router` and `queryClient`). Mock the network
  per test with `worker.use(...)` from `tests/component/api-mocks.ts`: `api.<operation>({ body })` (handlers
  generated from `openapi.json` by Hey API's `msw` plugin into `src/sdk/msw.gen.ts`), `apiError(operation,
  status, body)` (only statuses and bodies the operation declares), `apiFailure` (network error or non-JSON
  body), `held()` (a response that waits, for pending states), and `authFunction(name, answer)` with the
  shortcuts `auth.signIn`/`auth.signOut` for the account server functions (outside the contract; `answer`
  is their typed `AuthOutcome`, `'network'`, `'thrown'` or `held()`). A request to `/api` or `/_serverFn`
  without a handler fails the test. `#/lib/api-client.ts` is aliased to its browser branch
  (`tests/component/stubs/api-client.ts`), and `#/lib/auth.functions.ts` to a stub that posts each call to
  `/_serverFn/auth/<name>` (`tests/component/stubs/auth-functions.ts`).
- **Accessibility.** `expectAccessible(page, '<state>')` (`tests/e2e/support/a11y.ts`) fails on any axe
  violation of WCAG 2.0/2.1/2.2 A and AA or best practices. A new page or UI state is one entry in `STATES`
  in `tests/e2e/a11y.spec.ts`, a landmark snapshot in its `landmarks` block, and, if it has controls, a row
  in the tab-order table of `tests/e2e/keyboard.spec.ts` (`tabOrder` records every Tab stop, its accessible
  name and visible focus, and fails on a focus trap: `tabThrough` walks until a temporary sentinel after the
  last control, because what a browser does past the last control differs by engine).
  `navigateWithApiResponse(page, '/api/posts' | '/api/me/posts', response)` (`tests/e2e/support/app.ts`)
  reaches empty and failure states by answering the browser's API call on a client-side navigation; build
  list bodies with `lastPage(...)` so they match the contract's `PostPage`.
- **E2E isolation.** Specs run in parallel on one database and never depend on each other's data. Import
  `test` from `tests/e2e/support/app.ts`: every worker gets its own `author` (created verified through
  `scripts/create-user.ts`) and every browser and API context its own client IP (sign-in rate limit).
  Flows that change or delete an account use a throwaway one instead: `createAccount` from
  `tests/e2e/support/accounts.ts` (sign-up through the API, confirmed from the Mailpit mail), and a
  second signed-in browser comes from `newClient`, which gets its own client IP too.
  Find your posts by a unique body. Data several specs need is written once by the `seed` project
  (`tests/e2e/seed.setup.ts`), which runs before the browser projects; today that is more than a page of
  posts by an author only `posts-pagination.spec.ts` reads (`PAGINATED_AUTHOR`). Never publish many posts
  from a spec: a post published moments ago must stay on the first page of `/`.
- `verify:app` needs Mailpit (`pnpm mail:up`; `MAILPIT_SMTP_PORT`/`MAILPIT_HTTP_PORT` from `.env`). It
  starts two servers on one database per run: `APP_URL` with `AUTH_SIGN_UP=open` and loopback in
  `TRUSTED_PROXIES`, and `CLOSED_APP_URL` with the default closed sign-up and a proxy list that excludes the
  test process. The integration tests and then the E2E tests run against them, so both suites see each
  other's data. Only `auth-client-ip.test.ts` signs in on `CLOSED_APP_URL`: every request there shares the
  bucket of 127.0.0.1.
- Integration files run in parallel against the same two test users. Each file creates its own client IP
  sequence with `clientIps('<prefix>')` from `tests/integration/helpers.ts` (for example `192.0.2`), sent
  as `X-Forwarded-For`, so each file has its own sign-in rate-limit buckets. Use a prefix no other file
  uses.
- Assert only on posts the test created. An invariant over all of one author's posts (for example, an
  empty list) must be owned by a single file, because other files add posts for the same author
  concurrently.
- State-changing requests must send `Origin: <APP_URL>`. Without it, the CSRF middleware in
  `src/start.ts` answers 403 before authentication runs, so a test that expects 401 gets 403.
  `sdkClient(cookie)` and `postSignIn` send it; the anonymous `sdkClient()` does not.
- Environment for `verify:app` (`ALLOW_STALE_BUILD` also applies to `lighthouse`):
  - `TEST_DATABASE_URL`: use this fixed `*_test` database. It is reset (dropped and recreated) at the
    start and not dropped afterwards.
  - `KEEP_TEST_DB=1`: keep the per-run database after the run.
  - `ALLOW_STALE_BUILD=1`: skip the check that `.output` is newer than its sources (CI tests a downloaded
    build).
  - `VERIFY_PORT`: fixed port for the app (default: a free port).

## Memory safety

A misconfigured lint once reached 17 GB and crashed the maintainer's laptop.

- To check a few files, pass explicit paths: `pnpm lint src/x.ts`, `pnpm exec oxfmt --check src/x.ts`.
- Keep `node_modules/**`, `.output/**`, and `repos/**` out of every tool's scope. `.oxlintrc.json` and
  `.oxfmtrc.json` list all three in `ignorePatterns`, `tsconfig.json` includes only `src`, `scripts`,
  `tests`, and `*.config.ts` (and excludes `node_modules`, `.output`, and `repos`), and `.fallowrc.json`
  lists all three in `ignorePatterns`. A new tool or config needs the same exclusions.
- Run heavy commands one at a time under a memory cap. For example: `pnpm build` (about 1.9 GB peak),
  type-aware lint (about 1.5–1.7 GB peak, measured as cgroup memory including page cache), `verify:app`,
  and `lighthouse`:
  `systemd-run --user --scope -p MemoryMax=4G -p MemorySwapMax=0 -- pnpm build`.
- Read upstream code with `gh api` or `node scripts/vendor-source.ts`, not by cloning repositories.

## Generated and vendored files

Regenerate these files; never edit them by hand:

- `src/sdk/**` and `openapi.json`: `pnpm codegen`
- `src/routeTree.gen.ts`: `pnpm dev` or `pnpm build`
- `drizzle/**`: `pnpm db:generate` (only the new SQL file may be adjusted by hand, before it is applied anywhere)
- `.agents/skills/**`, `.claude/skills/**`, and `skills-lock.json`: the `skills` CLI
- `repos/**`: `scripts/vendor-source.ts`

## Version policy

- `package.json` uses exact versions, and `pnpm-lock.yaml` is meant to be committed (no commits exist
  yet). pnpm 12 blocks dependency build scripts (`allowBuilds`) and quarantines fresh releases
  (`minimumReleaseAge`). Each exception names an exact version in `pnpm-workspace.yaml`.
- Upgrade RC and beta packages (`effect`, `@tanstack/react-start`, `nitro`, `oxfmt`) in their own PR,
  with `check`, `check:drift`, and `verify:app` passing.
- Skills are pinned to a commit (`skills-lock.json`). Docs shipped inside packages are pinned by the
  lockfile.

## Sharp edges

- **Effect v4 RC.** `effect@latest` on npm is still v3, so most examples on the web use the wrong API.
  Check against `node_modules/effect`. Starting with the next RC after `4.0.0-rc.117`,
  `effect/unstable/httpapi` becomes `effect/http-api` and `effect/unstable/http` becomes `effect/http`,
  with no compatibility exports (Effect PRs #8354 and #8365). `effect/unstable/*` imports are confined to
  `src/contract`, `src/server/api`, and `scripts/openapi.ts`; when upgrading, rewrite them there, run
  `pnpm codegen`, and review the `openapi.json` diff. Core `effect` is also imported by `src/server/posts`
  and `src/server/db/client.ts`.
- **TypeScript.** `tsc` is TS 7 (`@typescript/native`). The package named `typescript` is the
  `@typescript/typescript6@6.0.2` shim, which loads `typescript@6.0.3`, because Hey API 0.99 crashes on
  TS 7 ([ADR 0002](docs/decisions/0002-typescript-7-with-typescript-6-alias.md)).
  `scripts/*.ts` run through Node's type stripping, so use erasable syntax only (no enums, namespaces,
  or constructor parameter properties).
- **Prerender.** Static routes go in `nitro({ prerender: { routes } })` in `vite.config.ts`: Nitro, the
  deployment layer, prerenders and serves them, and its `prerender:generate` hook writes each page's
  hash-based CSP ([ADR 0004](docs/decisions/0004-prerender-via-nitro.md)).
- **CSP.** No policy allows `'unsafe-inline'` ([ADR 0010](docs/decisions/0010-content-security-policy.md)).
  Never render `style` attributes or inline event handlers (`style={…}`, `onclick="…"` in raw HTML): the
  prerender build fails on them and browsers block them on SSR pages. Put head scripts and styles through
  the route's `head()` so the router adds the nonce.
- **Tailwind.** Keep `@import "tailwindcss" source("../")` in `src/styles/app.css`. Without it, Tailwind
  scans `.output`, SSR and client CSS hashes diverge, and the CSS returns 404 in production.
  `tests/integration/assets.test.ts` guards this.
- **Better Auth.** `auth.api.*` skips rate limiting, `disabledPaths` and plugin `onRequest` hooks (the
  endpoint allowlist); use it only for trusted server-side reads (`getSession`) and the CLI. Browser-triggered
  actions go through `callAuthEndpoint`. Sign-up answers success for an email that already exists
  (enumeration protection), so `scripts/create-user.ts` checks first. Its `storage: 'database'` rate limit is
  not atomic on Postgres, hence `src/server/auth-rate-limit.ts`. Keep `tanstackStartCookies()` last in
  `plugins`.
- **Origin.** `APP_URL` must be the public origin. SSR uses it as the SDK base URL, and a mismatch
  changes TanStack Query keys and causes a refetch after hydration. `src/start.ts` rejects
  state-changing requests from any other origin.
- **E2E.** Wait for `body[data-hydrated="true"]` before interacting. Input before hydration is lost.
  Import `test` and `expect` from `tests/e2e/fixtures.ts`, not `@playwright/test`: it fails the test on
  any Content-Security-Policy violation.

## Library docs and skills

- **Effect:** before writing Effect code, read `node_modules/effect/AGENTS.md` in full. Look up APIs in
  `node_modules/effect/src`.
- **TanStack Start and Router:** run `pnpm dlx @tanstack/intent@0.4.0 list`, then
  `pnpm dlx @tanstack/intent@0.4.0 load <package>#<skill>` for the matching skill (for example,
  `@tanstack/start-client-core#start-core/execution-model`). The `Load:` lines that `intent list` prints
  use `@tanstack/intent@latest`; replace `@latest` with `@0.4.0`.
- **shadcn/ui:** the skill in `.agents/skills/shadcn` loads automatically. Run the pinned CLI with
  `pnpm exec shadcn …` wherever the skill says `npx shadcn@latest`.
- **Better Auth, Fallow, and Playwright traces:** see [docs/agents/skills.md](docs/agents/skills.md).
- **Upstream docs or source not in `node_modules`:** see [docs/agents/dependency-sources.md](docs/agents/dependency-sources.md).
  Snapshots in `repos/` are read-only reference material.

## Decisions

Architecture decisions are recorded in [docs/decisions/](docs/decisions/README.md). Read the relevant ADR
before reversing a choice, for example adding tRPC or Zod, moving prerendering, or upgrading Drizzle to
1.0.
