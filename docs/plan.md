# Plan: remove workarounds, close known limits

Written 2026-09-26 from four investigations (Start/Nitro, Better Auth, Bulletproof React, testing/CI) that read
the installed sources, upstream `main`, issues and PRs, and ran experiments on copies of the repo. Each item
names the principled replacement; nothing here patches a dependency.

Status 2026-09-27: every item is done (commit in brackets) or kept on purpose. What remains waits for an
upstream release, listed under [Waiting on upstream](#waiting-on-upstream).

## Dependencies

- `pnpm deps:check` (non-blocking report) is added [07a78d6, 4d3aefb]. On 2026-09-27 it shows nothing that
  pnpm would install; newer releases inside pnpm's release quarantine (such as fallow 3.30.0) are not listed.
- Pinned from a dist-tag other than `latest`: `effect` and `@effect/vitest` 4.0.0-rc.117 (`rc`, the newest;
  `latest` is v3) and `@hey-api/openapi-ts` on its `next` snapshot, so the project runs TypeScript 7 only
  (ADR 0002) [4756e32].

## 1. Architecture: Bulletproof React (done)

- Tree `components/{ui,errors,layouts}`, `features/<name>/{api,components,utils}` (posts, auth), `lib/`,
  `routes/` as the app layer [c659fb5, 8450c3c]. Feature `api/` modules own query options and mutation hooks
  [3964abc]; login form and sign-out live in `features/auth` [7a3fce8], and data hooks only in `api/`
  (`useSignOut`) [2bf04f5].
- Enforcement: Fallow `autoDiscover` zones per feature, `components → features → app`, Oxlint
  `unicorn/filename-case` and `oxc/no-barrel-file`, a folder-name guard [3552384, 04c9a2b]. Lint and Fallow
  warnings fail `pnpm check` [7d451f5].
- Error boundaries: `errorComponent` on `/dashboard` and `/account`, and `SectionErrorBoundary` around
  sections that fail on their own (post list, composer, each account section) [53f8f91].

## 2. Workarounds

| Was | Now | Status |
| --- | --- | --- |
| CSP nonce via custom middleware; `'unsafe-inline'` on prerendered pages and styles | Nonce from `getRouter` (`createIsomorphicFn`), CSP in the root route `headers`; prerendered pages get `sha256` hashes from Nitro's `prerender:generate` hook (ADR 0010) | Done [76cddc7] |
| Global `console` patch for log sanitization | Global function middleware that logs server-function errors through `log()`; Nitro `error` hook for process errors; DB-failure test for leaks | Done [334d28b]. Start has no logger hook |
| Unknown server-function 404 by matching Start's error message | Removed; Start's own answer until upstream (ADR 0009) | Done [cbd7314]. Waiting on TanStack/router#8246 |
| `beforeLoad` freshness trick on `/` | Writes await `invalidatePosts` (`refetchType: 'all'`) | Done [6896619] |
| Custom `Head` without modulepreload + experimental `inlineCss` | Stock `HeadContent`, external CSS, compression at the edge, Lighthouse over HTTPS and HTTP/2 (ADR 0011) | Done [536471e, 12b1d91, 868546e]. Upstream: TanStack/router#8520 (ours, fixes #8511); commented on #6749 and #8212 |
| Shutdown registry on `globalThis` | Nitro `close` hook through `useNitroHooks()` | Done [a2e8e6a] |
| Custom client-IP header + trust of all private peers | Better Auth `advanced.ipAddress.trustedProxies` (`TRUSTED_PROXIES`); the peer is appended to `X-Forwarded-For`; resolver unit-tested; spoof test | Done [dc1ca01]. Nitro's srvx options passthrough is merged (nitrojs/nitro#4620, #4654) but not in the installed 3.0.260903-beta |
| Auth allowlist in the route handler | Local Better Auth plugin (`onRequest` → 404) | Done [5ef8fdb]. Waiting on better-auth#11078 (`enabledPaths`) to drop the plugin |
| In-memory rate limit (single instance) | Counters in the `rate_limit` table, shared by instances [4d5ba9e]. Better Auth's `storage: 'database'` is not atomic on Postgres, so `customStorage` counts with one atomic upsert (`src/server/auth-rate-limit.ts`) | Done [f6ae788]. Waiting on better-auth#11331 (atomic `incrementOne` in the Drizzle adapter) to use `storage: 'database'` alone |
| Auth tables `timestamp` without time zone | `auth.ts` is application code with `timestamptz`; `auth check schema` in `pnpm check` | Done [99495c8]. better-auth#9920 open (generator) |
| Nitro prerender instead of Start's | Kept on purpose: the deployment layer's mechanism (ADR 0004) | Kept. TanStack/router#7473 open |
| `bodyLimit` request middleware | Kept (application policy) | Kept until a Nitro release ships `maxRequestBodySize` (nitrojs/nitro#4620, merged, unreleased) |

## 3. Auth completeness (done)

Mailer interface with SMTP and log adapters, senders through `advanced.backgroundTasks`, Mailpit in
`compose.yaml` [8e6bf4d]; password reset, email verification, change password, session list and revoke,
account deletion through server functions [8ae8443]; both sign-up policies tested [605ccb2]. Sign-up is
configurable, closed by default (ADR 0003, owner decision). Success messages take focus [57064a0].

## 4. Performance

Caddy is the reference edge with compression [12b1d91]; Lighthouse runs through it with `benchmarkIndex`,
warnings, 100 on accessibility, best practices and SEO, performance by median and budgets, inconclusive on a
slow machine [c9b664d]. The Better Auth client left the bundle when every account action became a server
function [8ae8443]; `no-restricted-imports` in `.oxlintrc.json` keeps `better-auth` (client included) out of UI
code. The edge serves HTTPS with HTTP/2 to Lighthouse as in production; over plain HTTP/1.1 the simulation
opened a connection per preloaded script, and mobile scored 98 (ADR 0011) [868546e]. Mobile and desktop now
score 100 on every page (see stack-review).

## 5. Tests (done)

- E2E on chromium, firefox, webkit, Pixel 7 and iPhone 15 [4d95b74]; outside CI the default is chromium and
  firefox (WebKit needs Ubuntu's libraries), `pnpm ci:local verify` runs all five.
- axe on every page and UI state, keyboard and focus tests, ARIA landmark snapshots [78b7d32].
- Component tests in Vitest browser mode with MSW handlers generated from the contract [974d619, ba8735e].
- `@effect/vitest` + `HttpApiTest` for handler logic [69b105c].
- 100% line and branch coverage gate on security-critical pure modules [b4e82f3].
- Cursor pagination in the contract and a Load more list in the UI [3553585, c95e828, 5d9a739, f30d07d].

## 6. CI without GitHub (done)

Thin YAML, one `pnpm ci:<job>` script per job, `zizmor` next to actionlint [ad91c2e]; `pnpm ci:local` runs
the same scripts in the Playwright Ubuntu image next to Postgres [f1b26a9]. `act` stays a YAML smoke test
(nektos/act#6022). The workflow has not run on GitHub yet.

## Waiting on upstream

| Upstream | Then |
| --- | --- |
| Effect RC after 4.0.0-rc.117 (PRs #8354, #8365) | Rewrite `effect/unstable/*` imports to `effect/http-api` and `effect/http` |
| better-auth#11331 | Replace `customStorage` with `storage: 'database'` |
| better-auth#11078 | Replace the allowlist plugin with `enabledPaths` |
| TanStack/router#8246 | Unknown server function ids answer 404 (ADR 0009) |
| A Nitro release with nitrojs/nitro#4620 and #4654 | Drop the `bodyLimit` middleware for `maxRequestBodySize`; pass `trustProxy` |
| A stable Hey API release with the TypeScript-free printer | Leave the `next` snapshot (ADR 0002) |
| TanStack/router#7473 | Revisit ADR 0004 |
| TanStack/router#8520 (ours, fixes #8511) | Upgrade; `/` and `/dashboard` then preload `useBaseQuery-*.js`; re-run `pnpm lighthouse`. The 2.7 KB cost `/dashboard` a simulated round trip (1.51 → 1.66 s) unless about 1 KB leaves its first-load JavaScript first (ADR 0011) |
| GoogleChrome/lighthouse#16539 (its planned follow-up to #16782, "ignore modulepreloads when computing FCP and LCP"; #16782 alone changes nothing here, our LCP already equals FCP) | Lantern stops simulating preloaded scripts as blocking the first paint; mobile FCP should drop to about 0.8 s, and CI's 2-vCPU runner should score like the laptop (ADR 0011) |
| A StrykerJS vitest-runner release that filters by Vitest 5's full test names (stryker-js#6210; fixes in #6214, #6220, #6217; see [Mutation testing](#mutation-testing)) | Add mutation testing as a gate with the thresholds below |
| A Better Auth release whose `/revoke-other-sessions` deletes in one statement (better-auth#11433) | Lower its budget in `tests/db/query-budget.test.ts` to a constant |

### Mutation testing

StrykerJS 10.0.0's Vitest runner builds its per-mutant `testNamePattern` from test names joined with spaces,
while Vitest 5 matches `" > "`-joined full names: every test inside a `describe` is skipped, and a mutant that
makes a test file fail to import is also reported as Survived, so scores mean nothing today. Nothing is
patched here. Once a release fixes it, a `pnpm mutate` script runs Stryker on the files changed by a PR (CI, next to
`verify`) and on all of `src/` nightly, and fails below these mutation scores:

| Files | Threshold |
| --- | --- |
| Every module in `COVERAGE_GATE` (`vitest.config.ts`; it includes `forwarded-for.ts`, `client-address.ts` and the API `handlers.ts`) except the two below | 100 |
| `src/features/auth/utils/describe-session.ts`, `src/features/auth/utils/safe-redirect.ts` | 90 |
| `src/features/*/components/**`, `src/components/errors/**` | 80 |

Until then, mutants are checked by hand when a test is written for one: the property tests (fast-check) of
the cursor, `safeRedirect` and `forwardedFor` came from such a pass.
