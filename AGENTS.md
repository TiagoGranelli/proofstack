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
| `src/lib/` | Shared plumbing: `api-client.ts` (isomorphic SDK client), `api-error.ts`, `auth-client.ts`, `utils.ts`. `*.functions.ts` are server functions (`createServerFn`) | contract, sdk. The server adapters (`*.functions.ts`, `api-client.ts`) also import server and lib |
| `src/components/` | Shared UI that knows no feature: `ui/` (shadcn primitives, Radix, style `radix-nova`), `errors/` (router error and not-found states, `ApiErrorAlert`), `layouts/` (site header, pending state) | lib, contract, sdk |
| `src/features/<name>/` | One feature each (`posts`, `auth`): `api/` (query options and mutation hooks), `components/`, `utils/` | components, lib, server adapters, contract, sdk. Never another feature |
| `src/routes/`, `router.tsx`, `start.ts`, `styles/` | The app layer. Page routes define the route (loader, guards, head) and compose features. `api/$.ts` hands requests to the Effect API; `api/auth/$.ts` to Better Auth | Page routes: features, components, lib, server adapters, contract, sdk. `api/**` is a server adapter: server, contract, sdk, lib |

- Every module in `src/server/` starts with `import '@tanstack/react-start/server-only'`. The exceptions
  are `nitro/` plugins and `db/schema/`, which drizzle-kit and Better Auth's CLI load outside Start.
- UI and page routes reach data only through the SDK (`#/sdk/...`) or a server function in
  `#/lib/*.functions.ts`. They never import `src/server`, `drizzle-orm`, `pg`, or `better-auth` directly.
  Only the server adapters import `src/server`: `src/routes/api/**`, `src/lib/*.functions.ts`, and
  `src/lib/api-client.ts` (Fallow zone `server-adapters`).
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
`0003_auth_timestamptz.sql`), apply it with `pnpm db:migrate` (after `pnpm db:up`), and run
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
7. Integration tests in `tests/integration/` and E2E tests in `tests/e2e/` (see [Tests](#tests)).

**Auth config change** (plugins, user fields, rate-limit storage). `src/server/db/schema/auth.ts` is
application code: edit it by hand (timestamps stay `timestamptz`), then follow the database workflow.
`pnpm auth:check` (Better Auth's `auth check schema`, also run by `pnpm check`) fails until every table,
column, nullability and default the configuration writes exists. To see what Better Auth would generate, run
`pnpm exec auth generate --config src/server/auth.ts --output /tmp/auth-schema.ts -y` and port the
difference; never write its output over `auth.ts`.

**Users.** Run `pnpm user:create <email> <name>`. The password comes from `PROOFSTACK_USER_PASSWORD`,
otherwise from stdin: a hidden prompt (asked twice) in a terminal, or the whole input of a pipe. Public
sign-up is closed ([ADR 0003](docs/decisions/0003-closed-sign-up-cli-user-creation.md)).

**First setup.** Run `pnpm install && pnpm bootstrap`. This creates `.env` with a secret, starts
Postgres, and applies migrations.

## Verify

| Command | Covers |
| --- | --- |
| `pnpm check` | `format:check`, `lint` (warnings are counted in the summary but do not fail), `typecheck`, `deadcode`, `unit` (Vitest project `unit`, `tests/unit`), the database-free drift checks (contract, migrations, auth) and repo guards (including kebab-case folder names). No database, no build, about 4 s. Run it before every hand-off. |
| `pnpm test:unit [filter ...]` | Unit tests only: pure functions, no app |
| `pnpm format`, `pnpm lint:fix` | Autofixes |
| `pnpm check:drift [contract\|migrations\|auth\|database]` | Checks that generated files match their sources and that the auth schema holds what Better Auth writes; `database` needs Postgres |
| `pnpm build && pnpm verify:app [--no-e2e] [--no-integration] [filter ...]` | Starts the built server against a fresh per-run `proofstack_<purpose>_<pid>_test` database (dropped afterwards) and runs Vitest (`tests/integration`) and Playwright (`tests/e2e`); app logs go to `test-results/app-server.log`. Refuses a stale `.output` |
| `pnpm build && pnpm lighthouse [--runs=3] [--page=<name>] [--form-factor=mobile\|desktop]` | Lighthouse gate on the built app; see the policy below |

`pnpm test` (Vitest project `integration`) and `pnpm test:e2e` expect an app that is already running at
`APP_URL` with `TEST_USER_*` set; `verify:app` provides both.

**Lighthouse policy** (`POLICY` in `scripts/lighthouse.ts`): per page and form factor, every gated
category's median must be at least 99, at most one category may sit at 99, no single run may score below
95, and the median metrics must stay within the budgets. `agentic-browsing` is reported but not gated. SEO
is not gated on `/login` and `/dashboard` (noindex). CI runs `pnpm lighthouse --runs=5`.

## Tests

- Install the test browser once: `pnpm exec playwright install chromium`. `verify:app` and `lighthouse`
  use `CHROME_PATH` instead when it is set.
- `verify:app` starts one server on one database per run. The integration tests and then the E2E tests
  run against it, so both suites see each other's data.
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
- **Prerender.** Start's own prerender output is not served, so static routes go in
  `nitro({ prerender: { routes } })` in `vite.config.ts` ([ADR 0004](docs/decisions/0004-prerender-via-nitro.md)).
- **Tailwind.** Keep `@import "tailwindcss" source("../")` in `src/styles/app.css`. Without it, Tailwind
  scans `.output`, SSR and client CSS hashes diverge, and the CSS returns 404 in production.
  `tests/integration/assets.test.ts` guards this.
- **Better Auth.** `auth.api.signUpEmail` reports success for an email that already exists, so check for
  existence first (`scripts/create-user.ts`). Keep `tanstackStartCookies()` last in `plugins`.
- **Origin.** `APP_URL` must be the public origin. SSR uses it as the SDK base URL, and a mismatch
  changes TanStack Query keys and causes a refetch after hydration. `src/start.ts` rejects
  state-changing requests from any other origin.
- **E2E.** Wait for `body[data-hydrated="true"]` before interacting. Input before hydration is lost.

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
