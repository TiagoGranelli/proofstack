---
name: auth-change
description: Change accounts and authentication in this repo (Better Auth). Use when adding an account action such as changing a name, email or password, when changing the Better Auth config (plugins, user fields, rate-limit storage), or when creating users.
---

# Auth change

Read `src/server/AGENTS.md` first: it lists the Better Auth rules this code depends on.

## New account action

The browser reaches Better Auth only through server functions. An account action is:

1. A server function in `src/lib/auth.functions.ts` that validates its input with Effect Schema
   (`.validator(Schema.toStandardSchemaV1(...))`, the `server-fn-validator` guard) and calls
   `callAuthEndpoint`.
2. Its `METHOD /path` in `EXPOSED` in `src/server/http/auth-endpoints.ts`. Not in `HTTP_ENDPOINTS`, which
   `/api/auth/*` answers from outside.
3. A hook in `src/features/auth/api/` built on `useAuthMutation` (`auth-action.ts`), as `change-password.ts`.
4. A message for any new Better Auth error code in `src/features/auth/utils/describe-auth-failure.ts` (in the
   100% coverage gate).
5. Mail goes through `authMail` (`src/server/mail/`); its text lives in `auth-messages.ts`.
6. Tests: component tests through `authFunction(name, answer)` and `authCalls(name)`, integration tests through
   `callAuthFunction(name, ...)` on a throwaway account (read `tests/AGENTS.md`).

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

`pnpm user:create <email> <name>` creates a verified account. The password comes from
`PROOFSTACK_USER_PASSWORD`, otherwise from stdin: a hidden prompt (asked twice) in a terminal, or the whole input
of a pipe. Public sign-up is `AUTH_SIGN_UP=closed` by default
([ADR 0003](../../../docs/decisions/0003-sign-up-policy.md)).

## Done when

`pnpm check` and `pnpm build && pnpm verify:app` pass.
