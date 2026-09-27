# 0012: Three request surfaces: the HttpApi, server functions, and Better Auth's HTTP endpoints

Status: Accepted (2026-09-27)

## Context

The app answers requests on three surfaces, each with its own validation, errors and tests. Without a rule, a
new operation lands wherever the author happens to look first, and the contract (ADR 0001) stops describing
the app.

## Decision

| Surface | Where | Use it for | Errors |
| --- | --- | --- | --- |
| Effect `HttpApi` | `src/contract`, `src/server/api`, served at `/api/*` | Every business operation: reads and writes of the app's own data, anything another client (a script, a mobile app, a partner) may call | Tagged errors in the contract, mapped by `describeApiError` (exhaustive over the generated SDK) |
| Server functions | `src/lib/*.functions.ts` (`createServerFn`) | Account actions the UI offers (sign-in, sign-up, passwords, sessions, delete account), which run Better Auth's router in-process through `callAuthEndpoint`; route guards (`getSession`); small UI-only reads (`getSignUpPolicy`) | `AuthOutcome` values with a closed `AuthFailureCode`, mapped by `describeAuthFailure` (exhaustive) |
| Better Auth HTTP | `/api/auth/*` (`src/routes/api/auth/$.ts`), narrowed to `HTTP_ENDPOINTS` | Only what a client without the UI needs to use the business API with a cookie: `GET /get-session`, `POST /sign-in/email`, `POST /sign-out` | Better Auth's own JSON bodies; outside the contract |

A new operation goes in the `HttpApi` unless it is an account action or a guard. A new account action is a server
function plus an entry in `EXPOSED` (AGENTS.md, "Auth endpoint"); it reaches `HTTP_ENDPOINTS` only for a client
that cannot call a server function.

## Reasons

- The `HttpApi` is the product: one schema produces the OpenAPI document, the SDK, the validation and the
  handler types, and the api test layer checks every branch without a database. Business data behind a server
  function would be invisible to other clients and to the contract-coverage check.
- Account actions are Better Auth's endpoints, not ours to redescribe. Wrapping each one in a server function
  keeps the Better Auth client out of the browser bundle, validates a narrower input than Better Auth accepts
  (over raw HTTP, `/delete-user` deletes without a password while the session is fresh), keeps session tokens
  on the server (`/list-sessions` returns them), and still runs Better Auth's router, so its rate limits, origin
  check and the endpoint allowlist apply.
- `/api/auth/*` stays open for the three endpoints a non-browser client needs to obtain and drop the cookie the
  `HttpApi` authenticates with. Everything else answers 404 before Better Auth runs.

## Costs

- Three error vocabularies and three places to test them: `tests/api` for the `HttpApi`, `tests/component`
  stubs and `tests/integration/server-functions.ts` for server functions, `tests/integration` for `/api/auth/*`.
- Server function ids change per build, so they are not a stable API (ADR 0009), and account actions have no
  published description for other clients.
- The `_authed` guard reads the session through a server function while the `HttpApi` middleware reads it again
  for the same page.

## Revisit when

A second client needs account management (then describe those actions in the contract, backed by Better Auth),
or TanStack Start gives server functions stable, documented endpoints.
