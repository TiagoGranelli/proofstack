---
name: database-change
description: Change the Postgres schema of this repo with Drizzle. Use when adding or changing a table, column, index or constraint in src/server/db/schema, or when writing or reviewing a migration in drizzle/.
---

# Database change

## Steps

1. Edit `src/server/db/schema/*.ts`. `src/server/db/schema/auth.ts` is application code: edit it by hand and
   keep timestamps `timestamptz` (the `auth-change` skill says how to find what Better Auth needs).
2. Run `pnpm db:generate --name <slug>`. It writes a new SQL file and updates `drizzle/meta/`.
3. Review the new SQL in `drizzle/`. Only this new file may be adjusted by hand, and only before it is
   committed. A type change that must convert data gets its `USING` clause there, as in
   `0004_auth_timestamptz.sql`. An index on a large table is built by hand `CONCURRENTLY`
   ([docs/operations.md](../../../docs/operations.md#migration-safety)).
4. Apply it: `pnpm db:up`, then `pnpm db:migrate`.
5. Run `pnpm check:drift migrations` and `pnpm check:migrations` (squawk: no statement that blocks a busy
   table). Waive one statement only with `-- squawk-ignore <rule>` under a comment line giving the reason.
6. A new or changed repository query gets a query budget in `tests/db/<feature>-query-budget.test.ts`, then
   `pnpm test:db` (read `tests/AGENTS.md`).

## Rules

- Migrations already in the journal at `HEAD` are frozen: databases may have applied them, so
  `tests/unit/repo-policy.test.ts` rejects an edit. Change the schema and generate a new migration instead.
- `drizzle/meta/**` is written by `pnpm db:generate` only.

## Done when

`pnpm check:drift migrations`, `pnpm check:migrations`, `pnpm check:drift database` (needs Postgres) and
`pnpm check` pass, and the schema, the SQL file and `drizzle/meta/` are in one commit.
