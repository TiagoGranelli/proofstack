# tests/db/AGENTS.md

The db layer. [tests/AGENTS.md](../AGENTS.md) still applies.

- **db.** `tests/db` runs against a real, migrated database of its own (`tests/db/global-setup.ts`). A new
  repository method gets a query budget in its feature's `tests/db/<feature>-query-budget.test.ts` (as
  `posts-query-budget.test.ts`; shared services in `query-budget.test.ts`): `withBudget(name, n, effect)`
  (`tests/db/helpers.ts`) counts the statements an Effect built on `recordingDatabase` sends, and a list method
  must send as many for 1 row as for 50 (N+1 fails with the statements listed). A server path that reads rows
  through Better Auth is counted at pg's `Client` with `statementsOf` (tests/db/helpers.ts).
