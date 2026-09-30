---
name: auth-change
description: Change accounts and authentication in this repo (Better Auth). Use when adding an account action such as changing a name, email or password, when changing the Better Auth config (plugins, user fields, rate-limit storage), or when creating users.
---

# Auth change

Read `src/server/AGENTS.md` first: it lists the Better Auth rules this code depends on.

## New account action

The browser reaches Better Auth only through server functions; which surface an operation belongs on is
[ADR 0013](../../../docs/decisions/0013-three-request-surfaces.md). An account action is:

1. A server function in `src/lib/auth.functions.ts` that validates its input with Effect Schema
   (`.validator(Schema.toStandardSchemaV1(...))`; a lint rule rejects any other validator) and calls
   `callAuthEndpoint`. Its schema lives in `src/lib/account-input.ts`, where the forms reuse it; a string that
   reaches Postgres (a name, an email, a token) starts its checks with `isFreeOfNul`.
2. Its `METHOD /path` in `EXPOSED` in `src/server/http/auth-endpoints.ts`. Not in `HTTP_ENDPOINTS`, which
   `/api/auth/*` answers from outside.
3. A hook in `src/features/auth/api/` built on `useAuthMutation` (`auth-action.ts`), as `change-password.ts`.
4. Any new Better Auth error code in `BETTER_AUTH_CODES` (`src/server/http/auth-handler.ts`), the closed set
   of `AuthFailureCode`s; `pnpm typecheck` then fails until
   `src/features/auth/utils/describe-auth-failure.ts` (in the 100% coverage gate) gives it a message.
5. Mail goes through `authMail` (`src/server/mail/`); its text lives in `auth-messages.ts`.
6. Tests: component tests through `authFunction(name, answer)` and `authCalls(name)`, integration tests through
   `callAuthFunction(name, ...)` on a throwaway account (read `tests/integration/AGENTS.md`).

## Auth config change

For plugins, user fields and rate-limit storage:

1. Edit `src/server/auth.ts`, then `src/server/db/schema/auth.ts` by hand (timestamps stay `timestamptz`), then
   follow the `database-change` skill.
2. `pnpm auth:check` (Better Auth's `auth check schema`, also run by `pnpm check`) fails until every table,
   column, nullability and default the configuration writes exists.
3. To see what Better Auth would generate, run
   `pnpm exec auth generate --config src/server/auth.ts --output /tmp/auth-schema.ts -y` and port the
   difference by hand. Its output stays in `/tmp`; `auth.ts` is written by hand only.

## Users

`pnpm user:create <email> <name>` creates a verified account; in production, the image's bundled copy does
(`node .output/create-user.mjs <email> <name>`, docs/operations.md, "First account"). The password comes from
`CREATE_USER_PASSWORD`, otherwise from stdin: a hidden prompt (asked twice) in a terminal, or the whole input of a
pipe. Public sign-up is `AUTH_SIGN_UP=closed` by default
([ADR 0003](../../../docs/decisions/0003-sign-up-policy.md)).

## Done when

`pnpm check` and `pnpm build && pnpm verify:app` pass.
