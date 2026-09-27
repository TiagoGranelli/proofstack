# AGENTS.md

ProofStack is a full-stack template built around a verifiable API contract. `src/contract` generates
`openapi.json`, which generates `src/sdk`; the running API and the tests must agree with all three. A
change is done when `pnpm check` passes, plus `pnpm check:drift` and `pnpm build && pnpm verify:app` for
changes to the contract, database, auth, or UI flows.

## Architecture map

| Path | Role | May import |
| --- | --- | --- |
| `src/contract/` | Effect `HttpApi` contract: schemas, endpoints, tagged errors, middleware tags | `effect` and other `src/contract` modules only |
| `src/server/` | Server-only: Effect handlers (`api/`), Better Auth (`auth.ts`), Drizzle (`db/`), repositories, `env.ts`, shutdown `lifecycle.ts`. Read [src/server/AGENTS.md](src/server/AGENTS.md) before changing it | contract, sdk |
| `src/sdk/` | Hey API client and TanStack Query options (generated) | nothing |
| `src/lib/` | Shared plumbing: `api-client.ts` (isomorphic SDK client), `api-error.ts`, `utils.ts`. `*.functions.ts` are server functions (`createServerFn`): `session.functions.ts` (route guards), `auth.functions.ts` (every account action) | contract, sdk. The server adapters (`*.functions.ts`, `api-client.ts`) also import server and lib |
| `src/components/` | Shared UI that knows no feature: `ui/` (shadcn primitives, Radix, style `radix-nova`), `errors/` (router error and not-found states, `SectionErrorBoundary`, `ApiErrorAlert`), `layouts/` (site header, pending state) | lib, contract, sdk |
| `src/features/<name>/` | One feature each (`posts`, `auth`): `api/` (query options and mutation hooks), `components/`, `utils/` | components, lib, server adapters, contract, sdk. Never another feature |
| `src/routes/`, `router.tsx`, `start.ts`, `styles/` | The app layer. Page routes define the route (loader, guards, head) and compose features. `api/$.ts` hands requests to the Effect API; `api/auth/$.ts` to Better Auth | Page routes: features, components, lib, server adapters, contract, sdk. `api/**` is a server adapter: server, contract, sdk, lib |

- UI and page routes reach data only through the SDK (`#/sdk/...`) or a server function in
  `#/lib/*.functions.ts`. `src/server`, `drizzle-orm`, `pg` and `better-auth` (its client included) stay behind
  those: account actions are server functions that run Better Auth's router in-process (`callAuthEndpoint`),
  so rate limits and the endpoint allowlist apply. Authorization happens in the Effect `Authentication`
  middleware; the `_authed` route guard is only a UX redirect.
- Boundaries are enforced by Fallow zones in `.fallowrc.json` and by `no-restricted-imports` in
  `.oxlintrc.json`. A new top-level `src/` directory needs a zone before it can be used.
- Imports use the `#/` alias (`package.json#imports`) with explicit `.ts` or `.tsx` extensions.

### Where code goes

The UI follows [Bulletproof React](https://github.com/alan2207/bulletproof-react), with `src/routes/` as the app
layer. Imports flow one way: `components` → `features` → app (`routes/`).

- Feature code: `src/features/<name>/`. Read [src/features/AGENTS.md](src/features/AGENTS.md) before adding or
  changing one: it holds the data-access and mutation-hook conventions.
- UI shared by several features and free of feature knowledge: `src/components/` (`ui/`, `errors/`,
  `layouts/`); shadcn primitives go in `components/ui/` through `pnpm exec shadcn add`.
- Route files hold the route definition and a small page component that composes features (skill `add-page`).
- Naming: files and folders are kebab-case (Oxlint `unicorn/filename-case`; folders by
  `tests/unit/repo-policy.test.ts`). TanStack route names keep their prefixes (`__root.tsx`, `_authed.tsx`,
  `$.ts`, `-private/`, `(group)/`). `src/sdk/` is generated and exempt.
- Import the file that defines a symbol. Barrel files (`index.ts` re-exporting a folder) fail Oxlint
  `oxc/no-barrel-file`; the only one is `src/server/db/schema/index.ts`, Drizzle's schema entry.

## Workflows

Each multi-step workflow is a project skill in `.agents/skills/` (linked into `.claude/skills/`). Load it first:

| Task | Skill |
| --- | --- |
| Endpoint, schema or typed error in `src/contract` | `api-change` |
| Table, column, index or migration | `database-change` |
| A feature across database, API and UI | `add-feature` |
| Account action, Better Auth config, creating users | `auth-change` |
| New page, form or UI state | `add-page` |
| Any dependency bump, above all the pre-release pins | `upgrade-prerelease-deps` |

**First setup.** Run `pnpm install && pnpm bootstrap`. This creates `.env` with a secret, starts Postgres and
Mailpit (`pnpm mail:up`, the local inbox for account emails), and applies migrations.

## Verify

Read [tests/AGENTS.md](tests/AGENTS.md) before you write or change a test: it says which layer a behavior belongs
in and how each layer's harness works.

| Command | Covers |
| --- | --- |
| `pnpm check` | Every gate that needs no database and no build (format, type-aware lint, typecheck, Effect diagnostics, dead code, complexity, duplication, security sinks, unit/api/component tests with coverage, drift, migration lint, licenses), about 13 s. Run it before every hand-off; the lefthook pre-commit hook runs the jobs your staged files touch |
| `pnpm test:unit\|test:api\|test:component [filter ...]` | One fast layer; `pnpm test:fast` runs all three with coverage |
| `pnpm test:db [filter ...]` | The `db` layer on a throwaway Postgres database. Needs Postgres, no build |
| `pnpm format`, `pnpm lint:fix` | Autofixes |
| `pnpm check:drift [contract\|migrations\|auth\|database]` | Generated files match their sources, and the auth schema holds what Better Auth writes; `database` needs Postgres |
| `pnpm build && pnpm verify:app [filter ...]` | The built app against a throwaway database: `db`, integration and E2E layers. Needs Postgres and Mailpit (`pnpm mail:up`) |
| `pnpm build && pnpm lighthouse [--page=<name>]` | The Lighthouse gate behind the Caddy edge (needs Docker) |
| `pnpm ci:local [job ...]` | The CI jobs in the Playwright Ubuntu container (needs Docker) |

Every gate's failure message says how to fix it. What each gate covers, how to make a reviewed exception, the
Lighthouse policy and the less common commands (`deps:check`, `audit:check`, `images:*`, `sbom:release`) are in
[docs/agents/gates.md](docs/agents/gates.md).

## Memory safety

A misconfigured lint once reached 17 GB and crashed the maintainer's laptop.

- To check a few files, pass explicit paths: `pnpm lint src/x.ts`, `pnpm exec oxfmt --check src/x.ts`.
- Keep `node_modules/**`, `.output/**`, and `repos/**` out of every tool's scope. `.oxlintrc.json` and
  `.oxfmtrc.json` list all three in `ignorePatterns`, `tsconfig.json` includes only `src`, `scripts`,
  `tests`, and `*.config.ts` (and excludes `node_modules`, `.output`, and `repos`), and `.fallowrc.json`
  lists all three in `ignorePatterns`. A new tool or config needs the same exclusions.
- Run heavy commands one at a time (`pnpm build`, type-aware lint, `verify:app`, `lighthouse`); on Linux
  under a memory cap, see [docs/operations.md](docs/operations.md#linux-memory-caps).
- Read upstream code with `gh api` or `node scripts/vendor-source.ts`, not by cloning repositories.

## Generated and vendored files

Regenerate these files; edit their sources instead. Claude Code refuses edits to them (`.claude/settings.json`):
a refused edit means change the source and run the command.

- `src/sdk/**` and `openapi.json`: `pnpm codegen`
- `src/routeTree.gen.ts`: `pnpm dev` or `pnpm build`
- `drizzle/**`: `pnpm db:generate` (only the new SQL file may be adjusted by hand, before it is committed;
  `tests/unit/repo-policy.test.ts` rejects edits to migrations already in the journal)
- `.agents/skills/shadcn/**` and `skills-lock.json`: the `skills` CLI ([docs/agents/skills.md](docs/agents/skills.md)).
  The other skills in `.agents/skills/` are this repo's own and are edited by hand.
- `repos/**`: `scripts/vendor-source.ts`

## Version policy

Dependencies are pinned exactly, fresh releases are quarantined for a day, and the pre-release packages
(`effect`, `@effect/vitest`, `nitro`, `@tanstack/react-start`, `oxfmt`, `@hey-api/openapi-ts`) are upgraded one
per PR with `check`, `check:drift` and `verify:app` passing. The `upgrade-prerelease-deps` skill holds the full
policy; load it before changing `package.json` or `pnpm-workspace.yaml`.

## Sharp edges

- **Effect v4 RC.** `effect@latest` on npm is still v3, so most examples on the web use the wrong API. Before
  writing Effect code, read `node_modules/effect/AGENTS.md` in full; look up APIs in `node_modules/effect/src`.
- **TypeScript.** The project has one TypeScript, 7.0.2 (no JS compiler API). Hey API stays on its `next`
  snapshot; 0.99.0 crashes on TS 7 ([ADR 0002](docs/decisions/0002-typescript-7.md)). `scripts/*.ts` run through
  Node's type stripping, so use erasable syntax only (no enums, namespaces, or constructor parameter
  properties). The TanStack ESLint plugins (Oxlint `jsPlugins`) declare a TypeScript peer below 7; their rules
  use no type information and run fine.
- **CSP.** No policy allows `'unsafe-inline'` ([ADR 0010](docs/decisions/0010-content-security-policy.md)): style
  with classes, and put head scripts and styles through the route's `head()` so the router adds the nonce.
- **Tailwind.** Keep `@import "tailwindcss" source("../")` in `src/styles/app.css`. Without it, Tailwind scans
  `.output`, SSR and client CSS hashes diverge, and the CSS returns 404 in production (guarded by
  `tests/integration/assets.test.ts` and `tests/unit/repo-policy.test.ts`).
- **Origin.** `APP_URL` must be the public origin. SSR uses it as the SDK base URL, and a mismatch changes
  TanStack Query keys and causes a refetch after hydration. `src/start.ts` rejects state-changing requests from
  any other origin.
- **Prerender.** Nitro, the deployment layer, prerenders the routes in `vite.config.ts` and writes each page's
  hash-based CSP in its `prerender:generate` hook ([ADR 0004](docs/decisions/0004-prerender-via-nitro.md)).

## Library docs and skills

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
