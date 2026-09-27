# Stack review

Independent review of the ProofStack stack, based on official docs, package sources and tests run on the
maintainer's machine (Node 26.8.1, pnpm 12.3.4, Postgres 18.6 in Docker). Started 2026-09-26, final
measurements 2026-09-27. "Proven in repo" means covered by the gates below in this repository; "spike" means
observed only in a throwaway project.

## Verification log (final run, 2026-09-27)

| Gate | Command | Result |
| --- | --- | --- |
| Static | `pnpm check` | 7 gates in about 4 s: format, type-aware lint (incl. React Compiler and shadcn rules), `tsc` (TS 7.0.2), Fallow dead code + architecture zones, unit tests, database-free drift (contract, migrations, auth), repo guards. |
| Drift | `pnpm check:drift` | contract (openapi.json + SDK regenerate byte-identical), migrations (no pending `db:generate`), auth (Better Auth schema = `auth.ts`), database (migrations on a fresh DB = schema). |
| Build | `pnpm build` | OK in about 3 s, peak about 1.9 GB. Fails if prerendering fails. |
| App | `pnpm verify:app` | 60 integration tests (generated SDK against the built server and a fresh migrated database: contract equality, CRUD, author isolation, validation bodies, CSRF, auth surface, rate limits, CSP, caching, assets) and 9 Playwright flows (hydration without refetch, login/redirects, publish/edit/delete, error states). Graceful shutdown checked (about 1.0 s). Same result with `CI=true`. About 10 s. |
| Lighthouse | `pnpm lighthouse --runs=3` | `/`, `/about`, `/login`, `/dashboard`, mobile and desktop: every gated category median 100, except `/dashboard` mobile performance 99 (allowed: at most one 99 per page and form factor). SEO is not gated on noindex pages. `agentic-browsing` (new in Lighthouse 13.5) is reported, 100, not gated. |
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
| TypeScript | `tsc` = TS 7.0.2 (`@typescript/native` alias); `typescript` = TS 6 shim for tools | Hey API 0.99.0 crashes on TS 7 (hey-api#4235). Side-by-side setup from the TS 7 announcement. | Medium: tools that load `typescript` get TS 6. Drop when Hey API ships its TS-free printer. | Closed ([ADR 0002](decisions/0002-typescript-7-with-typescript-6-alias.md)) |
| Framework | TanStack Start 1.168.58 (RC), Router 1.170, Vite 8.3.1, Nitro 3 beta | Full slice works. Start's prerender output is not served by Nitro (TanStack/router#7473), so Nitro prerenders `/about`. | Medium: RC + beta | Closed ([ADR 0004](decisions/0004-prerender-via-nitro.md)) |
| CSS / UI | Tailwind 4.3.3 with `source("../")`, shadcn 4.21 (`-b radix`), system font, external CSS (stock `HeadContent`) | Without `source()` client and SSR CSS hashes diverged and CSS 404'd (TanStack/router#7658). shadcn now defaults to Base UI. Geist cost about 500 ms mobile FCP. Start's experimental `inlineCss` was dropped: the stylesheet is cached, and first paint is tuned at the edge. | Medium | Closed |
| React Compiler | Babel preset (`babel-plugin-react-compiler` 1.0) via `@rolldown/plugin-babel` | The Rust path in `@vitejs/plugin-react` 6 is experimental. | Low | Closed ([ADR 0006](decisions/0006-react-compiler-babel-preset.md)) |
| Business API | Effect 4.0.0-rc.117 `HttpApi` at `/api/*`; OpenAPI from `OpenApi.fromApi`; cookie security schemes; `ValidationError` 400 bodies on endpoints with input | Decode failures are empty 400s by default; server response encoding failures are kept as logged 500s. | **High churn**: `effect@latest` is v3; Effect PRs #8354/#8365 rename `effect/unstable/httpapi` → `effect/http-api` after rc.117. `effect/unstable/*` imports are confined to `src/contract`, `src/server/api`, `scripts/openapi.ts`. | Closed ([ADR 0001](decisions/0001-effect-httpapi-business-api.md)) |
| SSR data | Loaders call the generated SDK; on the server it dispatches in-process to the Effect handler with the request cookie | Every business operation goes through the contract. Query keys include `baseUrl`, so `APP_URL` must equal the public origin; E2E asserts no refetch after hydration. | Medium | Closed |
| tRPC, Zod, DaloyJS | Not adopted | HttpApi + OpenAPI + Hey API cover the typed client and TanStack Query hooks; missing: subscriptions and batching, not needed. | Low | Closed ([ADR 0007](decisions/0007-no-trpc-no-zod.md)) |
| Auth | Better Auth 1.7.6 + Drizzle adapter, email/password; HTTP allowlist (sign-in, sign-out, get-session); per-IP sign-in rate limit with a server-pinned client IP | Reviews found and fixed: rate-limit bypass/lockout, about 30 unneeded endpoints exposed, a sign-in that logged users out with a stale cookie. `signUpEmail` reports success for existing emails. | Medium | Closed |
| Sign-up | Closed over HTTP; `pnpm user:create` (hidden prompt, stdin or env) | Decided on the owner's behalf. | — | **Owner** ([ADR 0003](decisions/0003-closed-sign-up-cli-user-creation.md)) |
| Persistence | Postgres 18.6, Drizzle ORM 0.45.3 + drizzle-kit 0.31.11, `pg` 8.23; `scripts/migrate.ts` with advisory lock and bounded DDL lock timeout | Drizzle 1.0 is RC; its Effect integration targets Effect v3. | Low | Closed ([ADR 0005](decisions/0005-drizzle-0-45-stable.md)) |
| SDK | Hey API 0.99.0 (fetch client + TanStack Query plugin), committed in `src/sdk` | Deterministic; new error tags break typecheck until the UI maps them. | Low | Closed |
| Lint / format / architecture | Oxlint 1.85 + tsgolint (no ESLint), `@shadcn/lint` via `jsPlugins`, Oxfmt 0.70 (beta), Fallow 3.29 zones | All in `pnpm check`. A config that stopped ignoring `node_modules` once made tsgolint reach 17 GB; ignores now include it and tools are run with explicit scope. | Low | Closed |
| Lighthouse | Gate in `scripts/lighthouse.ts`, 5 runs in CI | Local medians above. GitHub runners are slower; watch the first CI run before tightening. | Medium | Hypothesis (CI unproven) |
| Skills / sources | shadcn skill pinned by commit; TanStack/Effect/Fallow/Playwright docs shipped in packages (pinned by lockfile); on-demand snapshots via `scripts/vendor-source.ts`, no subtree | Subtree needs a first commit, pulls 100–160 MB upstreams and cannot filter paths. Better Auth skills repo has no license. | Low | Closed ([ADR 0008](decisions/0008-agent-skills-and-dependency-sources.md)) |
| Operations | Dockerfile (non-root, healthcheck, SIGTERM), readiness/liveness, sanitized JSON logs, body limits, CSP with per-request nonce, no-store on private responses | See [operations.md](operations.md). Rate-limit counters are per process: multiple instances need a shared store. | Medium | Closed for one instance |

## RC/beta risk

Pre-1.0 or pre-release, pinned exactly: Effect v4 (weekly RCs), TanStack Start (RC), Nitro 3 (beta), Oxfmt
(beta), and the TS 7 alias around Hey API. Expect one upgrade PR every week or two with occasional mechanical
breaks (next: Effect import paths). Alternatives that keep most choices: Effect v3 `@effect/platform` HttpApi
(stable, same model, rewrite later) or Hono + OpenAPI for the API (loses Effect services and typed errors).
Neither is recommended: the RC set works end to end and the churn is confined to few files, with drift and
integration gates to catch breakage.

## Open items

- Owner decisions: closed sign-up ([ADR 0003](decisions/0003-closed-sign-up-cli-user-creation.md)), dropping
  the Geist font, `inlineCss`, and whether to allow shell execution in the shadcn skill (`npx shadcn@latest`
  inside `SKILL.md`; `AGENTS.md` tells agents to use the pinned CLI).
- First GitHub Actions run (Lighthouse on slower runners, Dependabot with pnpm 12 lockfiles).
- Name: "ProofStack" is used by other products (for example proofstack.build); revisit before publishing.
