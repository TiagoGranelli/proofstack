---
name: add-feature
description: Checklist for a new product feature in this repo that spans database, API contract, server and UI. Use when a task adds a capability end to end, such as a new resource, a new field users can set, or a new user-facing action.
---

# Add a feature

A new feature usually touches every layer, in this order. Each step names the skill or file with the details.

1. **Schema** in `src/server/db/schema/`, then `pnpm db:generate --name <slug>` and `pnpm db:migrate`
   (skill `database-change`).
2. **Contract** in `src/contract/`: schemas, endpoints, tagged errors. Constants the UI also needs (limits,
   lengths) go in `src/contract/limits.ts`, which stays free of Effect (skill `api-change`). An input schema a
   form also validates goes in a module without HttpApi code (`src/contract/post-input.ts`), so the browser
   loads Schema only.
3. **Repository** (for example `src/server/posts/repo.ts`) and **handler** in `src/server/api/handlers.ts`.
   A repository takes its client per statement from `Database.client`; a write of several statements runs in
   `Database.transaction(effect)` (`src/server/db/client.ts`, proven in `tests/db/transaction.test.ts`).
   Keep the in-memory repository in `tests/api/harness.ts` in step with the real one.
4. `pnpm codegen`.
5. **Errors:** map every new error tag to a message in `src/lib/api-error.ts`. `pnpm typecheck` fails until
   `describeApiError` handles it.
6. **UI** in `src/features/<name>/` (see "Where code goes" in `AGENTS.md`) and routes in `src/routes/`
   (skill `add-page` for a new page). An account action follows the `auth-change` skill instead.
7. **Tests**, cheapest layer first (read `tests/AGENTS.md`): handler branches in `tests/api/`, UI states in
   `tests/component/`, query budgets in `tests/db/`, then `tests/integration/` and `tests/e2e/` (each new page
   or UI state gets an entry in `STATES` in `tests/e2e/a11y.spec.ts`).

## Done when

`pnpm check`, `pnpm check:drift` and `pnpm build && pnpm verify:app` pass, and every generated file is
committed with its source.
