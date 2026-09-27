# Plan: remove workarounds, close known limits

Status 2026-09-27. Evidence comes from four investigations (Start/Nitro, Better Auth, Bulletproof React,
testing/CI) that read the installed sources, upstream `main`, issues and PRs, and ran experiments on copies of
the repo. Each item names the principled replacement; nothing here patches a dependency.

## Dependencies

Every dependency is on its npm `latest` (`pnpm outdated` is empty) except `effect`, whose `latest` is still v3;
v4 is used from the `rc` channel (4.0.0-rc.117, the newest). Not released yet and tracked: the Effect RC that
renames `effect/unstable/httpapi` → `effect/http-api` (PRs #8354/#8365), Hey API without the TypeScript
dependency (hey-api#4235; done differently: the project now uses TS 7 only with Hey API's `next` snapshot, ADR 0002), Nitro `maxRequestBodySize` and `trustProxy`
passthrough (nitrojs/nitro#4620, #4654). Add a non-blocking `pnpm deps:check` report.

## 1. Architecture: Bulletproof React

- Target tree: `components/{ui,errors,layouts}`, `features/<name>/{api,components,utils}` (posts, auth),
  `lib/` for shared plumbing, `routes/` as the thin app layer; `contract/`, `server/`, `sdk/` stay below.
- Feature `api/` modules own query options and mutation hooks (with cache invalidation); components stop
  calling generated mutations inline. Login form and sign-out move into `features/auth`; the header moves to
  `components/layouts`.
- Enforcement: Fallow `autoDiscover` gives every `src/features/*` its own zone (no cross-feature imports,
  verified on a copy), unidirectional `components → features → app`; Oxlint `unicorn/filename-case`
  (kebab-case) and `oxc/no-barrel-file`; a folder-name guard in `scripts/check.ts`.
- Error boundaries per route and per feature section, not only the global default.

## 2. Workarounds to replace

| Current | Replacement | Upstream |
| --- | --- | --- |
| CSP nonce via custom middleware + header; `'unsafe-inline'` on prerendered pages and styles | Upstream pattern: nonce created in `getRouter` (`createIsomorphicFn`), CSP set in the root route `headers`; prerendered pages get `sha256` hashes computed in Nitro's `prerender:generate` hook and emitted as route-rule headers; styles by nonce/hash | none needed |
| Global `console` patch for log sanitization | Global `functionMiddleware` that logs server-function errors through `log()` and rethrows a generic error; Nitro `error` hook for process-level errors; test that a forced DB failure leaks no parameters | Start has no logger hook (feature request) |
| Unknown server-function 404 by matching Start's error message | Remove. Correct behavior comes from TanStack/router PR #8246 | #8246 open |
| `beforeLoad` freshness trick on `/` | `invalidateQueries({ refetchType: 'all' })` awaited in mutation `onSuccess` | — |
| Custom `Head` without modulepreload + experimental `inlineCss` | Done: stock `HeadContent`, external CSS, compression by the edge, and Lighthouse measured through it over HTTPS and HTTP/2 (mobile 100, [ADR 0011](decisions/0011-lighthouse-over-https-http2.md)). No preload option needed | #8520 (ours, fixes #8511); commented on #6749, #8212 |
| Shutdown registry on `globalThis` | Nitro `close` hook registered from server code if `useNitroHooks` works in the SSR bundle; otherwise keep and document why | — |
| Custom client-IP header + trust of all private peers | Better Auth `advanced.ipAddress.trustedProxies` (CIDR list, `TRUSTED_PROXIES`); the route only appends the socket peer to `X-Forwarded-For`; pure resolver unit-tested; direct-spoof test with a server whose trust list excludes loopback | srvx `trustProxy` not passed by Nitro yet |
| Auth allowlist in the route handler | Same policy as a local Better Auth plugin (`onRequest` → 404) | `enabledPaths` PR better-auth#11078 |
| In-memory rate limit (single instance) | `rateLimit.storage: 'database'` (atomic increment, verified), `/get-session` excluded | — |
| Auth tables `timestamp` without time zone | Own `auth.ts` as application code with `timestamptz` + migration; gate with Better Auth's `auth check schema` and an integration test awaiting the adapter's schema check | better-auth#9920 |
| Nitro prerender instead of Start's | Keep: Nitro prerender is the deployment layer's documented mechanism; ADR 0004 reworded (not a workaround) | #7473 |
| `bodyLimit` request middleware | Keep (application policy) until Nitro releases `maxRequestBodySize` | nitro#4620 |

## 3. Auth completeness

Better Auth 1.7.6 ships every endpoint needed: password reset, email verification, change password with
`revokeOtherSessions`, session list/revoke, account deletion. Needed: a `Mailer` interface in
`src/server/mail` with an SMTP adapter (Nodemailer) and a capture adapter for tests, senders run through
`advanced.backgroundTasks` (no timing leak), Mailpit in `compose.yaml`, and E2E that reads links from the
Mailpit API. Sign-up policy: owner decision.

## 4. Performance

Compression at the reverse proxy (Caddy in `compose.yaml` as the reference edge), Lighthouse gate through it.
Remove the Better Auth client from the bundle (sign-in/out through server functions calling `auth.api.*`;
~11 KB brotli). Record `benchmarkIndex` and run warnings; accessibility, best practices and SEO must be 100 on
every run; performance by median + budgets; inconclusive (not failed) on a slow machine.

## 5. Tests

- E2E on chromium, firefox, webkit, Pixel 7 and iPhone 15 (45/45 passed in an Ubuntu container; WebKit can't
  run natively on CachyOS, so E2E runs in the Playwright container locally too).
- `@axe-core/playwright` on every page and UI state; keyboard and focus tests; ARIA snapshots.
- Component tests in Vitest browser mode with MSW handlers generated by Hey API's `msw` plugin.
- `@effect/vitest` + `HttpApiTest` for handler logic.
- 100% line/branch coverage gate on security-critical pure modules (redirect, client IP, error mapping).
- Cursor pagination in the contract and an infinite list in the UI.

## 6. CI without GitHub

Thin YAML: each job calls one `pnpm ci:<job>` script. `pnpm ci:local` runs the same scripts in the Playwright
Ubuntu image next to Postgres 18.6 (CPU/memory/shm limits), which is the faithful local equivalent. `act`
stays a YAML smoke test (its artifact support is broken: nektos/act#6022). Add `zizmor` to the workflow
lint alongside actionlint.
