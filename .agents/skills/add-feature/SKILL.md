---
name: add-feature
description: Checklist for a new product feature in this repo that spans database, API contract, server and UI. Use when a task adds a capability end to end, such as a new resource, a new field users can set, or a new user-facing action.
---

# Add a feature

A new feature usually touches every layer, in this order. Each step names the skill or file with the details.

1. **Schema** in `src/server/db/schema/`, then `pnpm db:generate --name <slug>` and `pnpm db:migrate`
   (skill `database-change`). A table of user content takes the shared columns of `schema/columns.ts`
   (`uuidv7Id`, `authorId`, `createdAt`, `updatedAt`, `trimmedTextCheck`) and, if it is listed, a keyset index
   ending in (created_at, id), as `post` has.
2. **Contract** in `src/contract/`: schemas, endpoints, tagged errors. Constants the UI also needs (limits,
   lengths) go in `src/contract/limits.ts`, which stays free of Effect (skill `api-change`). An input schema a
   form also validates goes in a module without HttpApi code (`src/contract/post-input.ts`), so the browser
   loads Schema only. A list endpoint takes `query: PageQuery` and answers `pageOf(Item)` (`src/contract/pages.ts`).
3. **Repository** (for example `src/server/posts/repo.ts`) and **handler** in `src/server/api/handlers.ts`,
   added to `ApiHandlers` there. Each statement goes through `query` (`src/server/db/query.ts`, with `DbError` and
   `isUuid`); a list reads a page with `keyset(table)` and `toPage`, and its handler turns the query into a
   request with `pageRequest` (`src/server/db/keyset.ts`). A write of several statements runs in
   `Database.transaction(effect)` (`src/server/db/client.ts`, proven in `tests/db/transaction.test.ts`).
   Provide the repository's Layer in `src/server/api/web-handler.ts` and an in-memory one in `apiLayer`
   (`tests/api/harness.ts`), built like `tests/api/posts-repo.ts` on `memoryPage` and `memoryClock`
   (`tests/api/memory-keyset.ts`). Name it `src/server/<feature>/repo.ts`: Oxlint keeps drivers and
   singletons out of that path.
4. `pnpm codegen`.
5. **Errors:** map every new error tag to a message in `src/lib/api-error.ts`. `pnpm typecheck` fails until
   `describeApiError` handles it.
6. **UI** in `src/features/<name>/` (see "Where code goes" in `AGENTS.md`) and routes in `src/routes/`
   (skill `add-page` for a new page). Reuse the shared list pieces `src/features/AGENTS.md` names instead of
   copying the posts ones. An account action follows the `auth-change` skill instead.
7. **Tests**, cheapest layer first (read `tests/AGENTS.md`): handler branches in `tests/api/`, UI states in
   `tests/component/`, query budgets in `tests/db/`, then `tests/integration/` and `tests/e2e/` (each new page
   or UI state gets an entry in `STATES` in `tests/e2e/a11y.spec.ts`).

## Done when

`pnpm check`, `pnpm check:drift` and `pnpm build && pnpm verify:app` pass, and every generated file is
committed with its source.
