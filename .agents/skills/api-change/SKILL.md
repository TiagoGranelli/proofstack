---
name: api-change
description: Change the HTTP API contract of this repo. Use when adding or changing an endpoint, a request or response schema, or a typed error in src/contract, or a handler in src/server/api/handlers.ts.
---

# API change

The contract in `src/contract` generates `openapi.json`, which generates `src/sdk`. The three are committed
together and must agree; the running API and the tests must agree with all three.

## Steps

1. Edit the contract in `src/contract/`: schemas, endpoints, tagged errors (`Schema.TaggedError` with
   `httpApiStatus`). Constants the UI also needs (limits, lengths) go in `src/contract/limits.ts`, which stays
   free of Effect so client bundles do not pull in the schema runtime. A user-supplied string that is stored
   or looked up in Postgres starts its checks with `isFreeOfNul` (`src/contract/stored-text.ts`): Postgres text
   cannot hold U+0000, and without the check a NUL answers 500 instead of 400.
2. Put a new endpoint that needs a session in a group behind the `Authentication` middleware (as `MyPosts` in
   `src/contract/posts.ts`), with a path under `/api/me/` (a comment on a post is `POST /api/me/posts/{postId}/comments`,
   not `POST /api/posts/{postId}/comments`): `tests/unit/openapi-rules.test.ts` fails otherwise. A public endpoint is a deliberate edit to `PUBLIC_OPERATIONS` in
   `tests/api/public-operations.test.ts`, which expects 401 without a session from every other operation. Add
   endpoints to the contract, never as raw Start server routes: a lint rule allows only `src/routes/api/$.ts` and
   `src/routes/api/auth/$.ts`.
3. Implement the handler in `src/server/api/handlers.ts` (a new group joins `ApiHandlers` there) and any
   repository method it needs (for example `src/server/posts/repo.ts`). Keep the in-memory repository of
   `tests/api/harness.ts` in step with the real one. A change to stored data follows the `database-change` skill
   first.
4. Run `pnpm codegen` to regenerate `openapi.json` and `src/sdk/`. Never edit either by hand.
5. Map every new error tag to a message in `src/lib/api-error.ts`. Its error union is derived from the
   generated SDK, so `pnpm typecheck` fails until the switch in `describeApiError` handles the new tag.
6. Test, cheapest layer first (read `tests/api/AGENTS.md`): every handler branch in `tests/api/` through
   `clientAs(...)` (`handlers.ts` is in the 100% coverage gate), including each declared status, because the
   contract-coverage check after a full `verify:app` fails on a declared status no test provoked. A repository
   method also gets a query budget in `tests/db/<feature>-query-budget.test.ts`. `tests/api/database-down.test.ts`
   and `tests/api/public-operations.test.ts` cover a new operation without edits (`tests/api/operations.ts`).

## Done when

- `pnpm check:drift contract` and `pnpm check` pass.
- `openapi.json`, `src/sdk/` and their sources are in the same commit.
- For a change a user can reach: `pnpm build && pnpm verify:app` passes.
