# 0001: The Effect HttpApi is the business API, with in-process SSR dispatch

Status: Accepted (2026-09-26)

## Context

ProofStack promises that the published OpenAPI document, the generated client, the running API, and the
tests all agree. If some business operations bypassed the API, for example SSR loaders querying the
database directly, the contract would no longer describe them.

## Decision

- Every business operation is an endpoint of the Effect 4 `HttpApi` in `src/contract`, served at `/api/*`
  by `src/routes/api/$.ts`, which forwards to `apiHandler` in `src/server/api/web-handler.ts`.
- `openapi.json` is generated from the contract with `OpenApi.fromApi` (`pnpm openapi:generate`), without
  a server or database. Hey API generates `src/sdk` from it. Both are meant to be committed (no commits
  exist yet).
- SSR loaders use the same generated SDK. On the server, its `fetch` calls `apiHandler` in-process
  (`src/server/api/in-process-client.ts`) and forwards the request cookie, so SSR goes through the same
  validation and middleware as browser calls without a network hop.
- Better Auth's own endpoints (`/api/auth/*`) are outside the business contract.

## Evidence

- `tests/integration/api.test.ts` checks that the served `/api/openapi.json` equals `openapi.json` in the
  repository, covers CRUD through the SDK, and checks 401, 400 (`ValidationError`), 404, and CSRF 403
  responses.
- `tests/e2e/flows.spec.ts` checks that the public page makes no `/api/` requests after hydration. This
  shows that SSR and the browser produce the same TanStack Query keys (base URL = `APP_URL`).
- By default, Effect returns an empty, undocumented 400 when decoding fails. The `RequestValidation`
  middleware maps it to a documented `ValidationError` body.

## Consequences

- Contract changes follow edit `src/contract`, then `pnpm codegen`, then commit all outputs.
  `pnpm check:drift contract` enforces this.
- `APP_URL` must equal the public origin. Otherwise the SSR and browser query keys differ, and the page
  refetches after hydration.
- Effect v4 is a weekly RC. `effect/unstable/*` imports are confined to `src/contract`,
  `src/server/api`, and `scripts/openapi.ts`; core `effect` is also imported by `src/server/posts` and
  `src/server/db/client.ts`. The release after rc.117 moves `effect/unstable/httpapi` to
  `effect/http-api` and `effect/unstable/http` to `effect/http`, with no compatibility exports and with
  renamed service keys (Effect PRs #8354 and #8365).

## Revisit when

Effect v4 goes stable (pin a stable version and drop the RC caveats); the path change lands (update the
imports and review the `openapi.json` diff); or the API needs subscriptions or streaming that `HttpApi`
cannot express.
