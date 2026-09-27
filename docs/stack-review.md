# Stack review

Independent review of the ProofStack stack, based on official docs, package sources and tests run on the
maintainer's machine (Node 26.8.1, pnpm 12.3.4, Postgres 18.6 in Docker). Started 2026-09-26, final
measurements 2026-09-27. "Proven in repo" means covered by the gates below in this repository; "spike" means
observed only in a throwaway project.

## Verification log (final run, 2026-09-27)

| Gate | Command | Result |
| --- | --- | --- |
| Static | `pnpm check` | 7 gates in about 9 s: format, type-aware lint with zero warnings (incl. React Compiler and shadcn rules), `tsc` (TS 7.0.2), Fallow dead code + architecture zones (every finding fails), tests (266: 110 unit, 45 api, 111 component in Chromium, with the coverage gate), database-free drift (contract, migrations, auth), repo guards. Passes on a fresh clone with no `test-results/`. |
| Drift | `pnpm check:drift` | contract (openapi.json + SDK regenerate byte-identical), migrations (no pending `db:generate`), auth (Better Auth schema = `auth.ts`), database (migrations on a fresh DB = schema). |
| Build | `pnpm build` | OK in about 3 s (peak about 1.9 GB measured earlier). Fails if prerendering fails. |
| App | `pnpm verify:app` | 127 integration tests in 14 files (generated SDK against the built servers, open and closed sign-up, on a fresh migrated database: contract equality, CRUD, author isolation, validation bodies, CSRF, auth surface, both sign-up policies, client IPs, rate limits, CSP, caching, assets, database failure, API write limits) and 145 Playwright tests (the seed, then 72 per browser on chromium and firefox: flows, account lifecycle through Mailpit, pagination, axe on every page state, keyboard and focus, CSP violations). Graceful shutdown checked (about 1.0 s). About 50 s. `pnpm ci:local verify` runs all five browser projects. |
| Lighthouse | `pnpm lighthouse --runs=5` | Through the Caddy edge over HTTPS and HTTP/2 ([ADR 0011](decisions/0011-lighthouse-over-https-http2.md)). Every page, mobile and desktop: performance, accessibility, best practices and SEO (where gated) medians 100; mobile FCP = LCP 1.50 s (desktop 0.32–0.37 s), TBT 0, CLS 0, 132–146 KiB. 39 of 40 mobile runs at 100 on a quiet machine; the 1.50 s sit one simulated round trip below 99, so a busy machine yields 99s (ADR 0011). Over plain HTTP/1.1 the same build scores 98 (dashboard 97). |
| CI config | actionlint | 0 findings; all actions pinned by commit SHA. The workflow has not run on GitHub (no remote). |

Mutation testing: 29 mutants in the first round, 8 survived (including three author-isolation bugs, because
tests used a single user). All 8 are now killed, plus the mutants from a second round on the new features.
An agent simulation (implementing "pinned posts" from `AGENTS.md` alone) finished with all gates green;
the gates caught forgotten codegen, a forgotten migration and a UI → server import, each with a fix hint.

## Decision matrix

Closed = decided and proven in repo. Hypothesis = chosen, needs more evidence. Owner = needs the owner's confirmation.

| Area | Decision | Evidence | Risk | Status |
| --- | --- | --- | --- | --- |
| Runtime | Node 26.8.1 (`.node-version`, Docker), `engines >=26 <27` | Vite 8 tests Node 26; Nitro/Start declare `>=22.12`. No Node 26 issues found. | Low | Closed |
| Package manager | pnpm 12.3.4 (`packageManager`, `engineStrict`, frozen lockfile) | Blocks dependency build scripts and quarantines fresh releases by default; exceptions are explicit in `pnpm-workspace.yaml`. Node 26 has no Corepack. | Low | Closed |
| TypeScript | TS 7.0.2 only; Hey API pinned to its `next` snapshot, which no longer uses the TypeScript API | Hey API 0.99.0 crashes on TS 7 (hey-api#4235); the snapshot generates the same SDK (indentation-only diff) and every gate passes. | Medium: a snapshot, not a stable release. Switch when a stable release includes the new printer. | Closed ([ADR 0002](decisions/0002-typescript-7.md)) |
| Framework | TanStack Start 1.168.58 (npm `latest`; Start's docs still describe it as a Release Candidate), Router 1.170, Vite 8.3.1, Nitro 3.0.260903-beta (npm `latest` is this beta) | Full slice works. Start's prerender output is not served by Nitro (TanStack/router#7473), so Nitro prerenders `/about`. | Medium: RC + beta | Closed ([ADR 0004](decisions/0004-prerender-via-nitro.md)) |
| CSS / UI | Tailwind 4.3.3 with `source("../")`, shadcn 4.21 (`-b radix`), system font, external CSS (stock `HeadContent`) | Without `source()` client and SSR CSS hashes diverged and CSS 404'd (TanStack/router#7658). shadcn now defaults to Base UI. Geist cost about 500 ms mobile FCP. Start's experimental `inlineCss` was dropped: the stylesheet is cached, and first paint is tuned at the edge. | Medium | Closed |
| React Compiler | Babel preset (`babel-plugin-react-compiler` 1.0) via `@rolldown/plugin-babel` | The Rust path in `@vitejs/plugin-react` 6 is experimental. | Low | Closed ([ADR 0006](decisions/0006-react-compiler-babel-preset.md)) |
| Business API | Effect 4.0.0-rc.117 `HttpApi` at `/api/*`; OpenAPI from `OpenApi.fromApi`; cookie security schemes; `ValidationError` 400 bodies on endpoints with input | Decode failures are empty 400s by default; server response encoding failures are kept as logged 500s. | **High churn**: `effect@latest` is v3; Effect PRs #8354/#8365 rename `effect/unstable/httpapi` → `effect/http-api` after rc.117. `effect/unstable/*` imports are confined to `src/contract`, `src/server/api`, `scripts/openapi.ts`. | Closed ([ADR 0001](decisions/0001-effect-httpapi-business-api.md)) |
| SSR data | Loaders call the generated SDK; on the server it dispatches in-process to the Effect handler with the request cookie | Every business operation goes through the contract. Query keys include `baseUrl`, so `APP_URL` must equal the public origin; E2E asserts no refetch after hydration. | Medium | Closed |
| tRPC, Zod, DaloyJS | Not adopted | HttpApi + OpenAPI + Hey API cover the typed client and TanStack Query hooks; missing: subscriptions and batching, not needed. | Low | Closed ([ADR 0007](decisions/0007-no-trpc-no-zod.md)) |
| Auth | Better Auth 1.7.6 + Drizzle adapter, email/password. Account actions only through server functions that run Better Auth's router in-process; over HTTP only `GET /get-session`, `POST /sign-in/email` and `POST /sign-out`, for API clients that need the session cookie. Rate limits counted in Postgres (one atomic upsert per request, shared by every instance) per client IP resolved through `TRUSTED_PROXIES` | Reviews found and fixed: rate-limit bypass/lockout, a non-atomic database rate limit (better-auth#11331), about 30 unneeded endpoints exposed, a sign-in that logged users out with a stale cookie. Sign-up answers the same for existing emails. | Medium | Closed |
| Sign-up | Configurable: `AUTH_SIGN_UP=closed` (default; accounts from `pnpm user:create`) or `open` (with email verification, needs SMTP). The full account lifecycle works in both | Owner decision. Both policies run side by side in `verify:app`. | Low | Closed ([ADR 0003](decisions/0003-sign-up-policy.md)) |
| Persistence | Postgres 18.6, Drizzle ORM 0.45.3 + drizzle-kit 0.31.11, `pg` 8.23; `scripts/migrate.ts` with advisory lock and bounded DDL lock timeout | Drizzle 1.0 is RC; its Effect integration targets Effect v3. | Low | Closed ([ADR 0005](decisions/0005-drizzle-0-45-stable.md)) |
| SDK | Hey API `next` snapshot (fetch client, TanStack Query and MSW plugins), committed in `src/sdk` | Deterministic; new error tags break typecheck until the UI maps them. | Low | Closed |
| Lint / format / architecture | Oxlint 1.85 + tsgolint (no ESLint), `@shadcn/lint` via `jsPlugins`, Oxfmt 0.70 (0.x, announced as beta), Fallow 3.29 zones | All in `pnpm check`, with zero warnings allowed (every rule is error or off). A config that stopped ignoring `node_modules` once made tsgolint reach 17 GB; ignores now include it and tools are run with explicit scope. | Low | Closed |
| Lighthouse | Gate in `scripts/lighthouse.ts` through the Caddy edge over HTTPS and HTTP/2, 5 runs in CI | Mobile 100 with little margin: Lantern simulates the preloaded scripts as blocking the first paint (GoogleChrome/lighthouse#16539), and CPU noise on a busy machine moves single runs to 99. GitHub runners are slower; watch the first CI run before tightening. | Medium | Measured ([ADR 0011](decisions/0011-lighthouse-over-https-http2.md)) |
| Skills / sources | shadcn skill pinned by commit; TanStack/Effect/Fallow/Playwright docs shipped in packages (pinned by lockfile); on-demand snapshots via `scripts/vendor-source.ts`, no subtree | Subtree needs a first commit, pulls 100–160 MB upstreams and cannot filter paths. Better Auth skills repo has no license. | Low | Closed ([ADR 0008](decisions/0008-agent-skills-and-dependency-sources.md)) |
| Operations | Dockerfile (non-root, healthcheck, SIGTERM), readiness/liveness, sanitized JSON logs, body limits, CSP with per-request nonce, no-store on private responses | See [operations.md](operations.md). Rate-limit counters live in Postgres, so instances share them. | Medium | Closed |

## RC/beta risk

Pre-1.0 or pre-release, pinned exactly: Effect v4 (weekly RCs from the `rc` dist-tag), TanStack Start (npm
`latest` is 1.168.58, but its docs still call it a Release Candidate), Nitro 3 (its npm `latest` is a beta),
Oxfmt (0.x, announced as beta) and Hey API's `next` snapshot. `pnpm deps:check` reports newer releases. Expect one upgrade PR every week or two with occasional mechanical
breaks (next: Effect import paths). Alternatives that keep most choices: Effect v3 `@effect/platform` HttpApi
(stable, same model, rewrite later) or Hono + OpenAPI for the API (loses Effect services and typed errors).
Neither is recommended: the RC set works end to end and the churn is confined to few files, with drift and
integration gates to catch breakage.

## Open items

- Owner decisions: dropping the Geist font, and whether to allow shell execution in the shadcn skill
  (`npx shadcn@latest` inside `SKILL.md`; `AGENTS.md` tells agents to use the pinned CLI). Sign-up is decided
  ([ADR 0003](decisions/0003-sign-up-policy.md)); `inlineCss` was dropped.
- Lighthouse: TanStack/router#8520 (transitive route preloads) to take when released ([ADR 0011](decisions/0011-lighthouse-over-https-http2.md)).
- Upstream releases the code waits for: [plan.md, "Waiting on upstream"](plan.md#waiting-on-upstream).
- First GitHub Actions run (Lighthouse on slower runners, Dependabot with pnpm 12 lockfiles).
- Name: "ProofStack" is used by other products (for example proofstack.build); revisit before publishing.
