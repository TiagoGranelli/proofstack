# src/server/AGENTS.md

Server-only code: Effect handlers (`api/`), Better Auth (`auth.ts`), Drizzle (`db/`), repositories, `env.ts`,
shutdown (`lifecycle.ts`). Read this before you change anything here. The root `AGENTS.md` still applies.

## Rules

- Every module here starts with `import '@tanstack/react-start/server-only'`. The exceptions are `nitro/`
  plugins and `db/schema/`, which drizzle-kit and Better Auth's CLI load outside Start.
- Only the server adapters import `src/server`: `src/routes/api/**`, `src/lib/*.functions.ts`,
  `src/lib/api-client.ts`, `src/lib/app-origin.ts` (the validated APP_URL for `src/start.ts`, through
  `createServerOnlyFn`) and `src/lib/server-function-errors.ts`, the global function middleware (Fallow zone
  `server-adapters`).
- SSR loaders call the same SDK as the browser. On the server it dispatches in-process to the Effect handler
  (`api/in-process-client.ts`), so every business operation goes through the contract. It sends GET only:
  writes come from the browser, through the CSRF check. The session is looked up once per request and shared
  by the route guard and the API middleware (`http/request-session.ts`). Which surface an operation belongs
  on (HttpApi, server function, Better Auth HTTP):
  [ADR 0013](../../docs/decisions/0013-three-request-surfaces.md).
- Authorization happens in the Effect `Authentication` middleware (`api/middleware.ts`). The `_authed` route
  guard is only a UX redirect. Ownership is part of each repository query's `WHERE`, so another author's id
  behaves like a missing one.
- A repository sends each statement through `query` (`db/query.ts`), which takes the client from
  `Database.client`, and pages a list with `db/keyset.ts`; a write of several statements runs in
  `Database.transaction(effect)` (`db/client.ts`, proven in `tests/db/transaction.test.ts`).
- A repository method sends a fixed number of statements, whatever the page size: every new one gets a query
  budget in `tests/db/<feature>-query-budget.test.ts` (see `tests/db/AGENTS.md`).
- The Effect API (`api/`, `<feature>/repo.ts`) gets what it needs from Layers (`Database`, `PostsRepo`,
  `RateLimitStore`, `SessionLookup`), so `tests/api` can provide fakes; it never imports Better Auth's `auth`,
  `db`, `pool` or a driver (Oxlint `no-restricted-imports`). `env` and `log` are the process-wide exceptions. A
  third-party library is imported by the module that owns it: `pg` by `db/client.ts`, `nodemailer` by
  `mail/smtp-mailer.ts` behind `Mailer`, Better Auth by `auth*.ts` and `http/`. React, TanStack and Effect are
  frameworks: follow their conventions instead of wrapping them.
- Read settings through `env.ts`, which validates them at import. A new setting goes there, in `.env.example`,
  and in `tests/unit/env.test.ts` (`env.ts` is in the coverage gate). `import.meta.env.VITE_*` ships to the
  browser; a lint rule rejects it.

## Effect v4 RC

`effect@latest` on npm is still v3, so most examples on the web use the wrong API. Read
`node_modules/effect/AGENTS.md` in full before writing Effect code, and look up APIs in `node_modules/effect/src`.
`effect/unstable/*` imports are confined to `src/contract`, `src/server/api`, and `scripts/openapi.ts`. Core
`effect` is also imported by `src/server/posts` and `src/server/db`. The coming rename of those paths is
covered by the `upgrade-prerelease-deps` skill.

## Better Auth

- `auth.api.*` skips rate limiting, `disabledPaths` and plugin `onRequest` hooks (the endpoint allowlist). Use
  it only for trusted server-side reads (`getSession`) and the CLI. Browser-triggered actions go through
  `callAuthEndpoint` (`http/auth-handler.ts`), which runs Better Auth's router in-process.
- Sign-up answers success for an email that already exists (enumeration protection), so
  `scripts/create-user.ts` checks first.
- Its `storage: 'database'` rate limit is not atomic on Postgres (better-auth#10557), hence `auth-rate-limit.ts`.
- Keep `tanstackStartCookies()` last in `plugins`.
- `db/schema/auth.ts` is application code, edited by hand; the `auth-change` skill covers config changes and
  new account actions.
