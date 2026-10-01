# 0005: Drizzle ORM 0.45 stable, not 1.0 RC

Status: Accepted (2026-09-26)

## Context

On 2026-09-27, npm `latest` for Drizzle ORM is `0.45.3`, and `rc` is `1.0.0-rc.4`, with rc.5 snapshots
being published. 1.0 is still a release candidate.

Corrected on 2026-10-01: this record first said that Drizzle 1.0's Effect integration targets Effect v3. It
does not. `drizzle-orm@1.0.0-rc.4` declares the peer `effect >=4.0.0-beta.83` and exports
`drizzle-orm/effect-postgres`; the v3 package is `@effect/sql-drizzle`. The decision rests on 1.0 being a
release candidate.

## Decision

Pin `drizzle-orm@0.45.3` and `drizzle-kit@0.31.11` with the `pg` driver. Call Drizzle through
`Effect.tryPromise` inside `PostsRepo` (`src/server/posts/repo.ts`) instead of an Effect-native
integration. Generate SQL migrations with `pnpm db:generate` and commit them in `drizzle/`.

## Evidence

Every `pnpm verify:app` run applies the migrations to a fresh database. Running `drizzle-kit generate`
twice reports no changes. `pnpm check:drift migrations database` guards against schema and migration
drift.

## Consequences

The code uses the stable API, with the RC churn deferred. Moving to 1.0 later is a separate migration,
following Drizzle's upgrade guide. The Better Auth adapter (`@better-auth/drizzle-adapter`) must support
whichever Drizzle version is in use.

## Revisit when

Drizzle 1.0 is tagged `latest`. Its `drizzle-orm/effect-postgres` would then replace the `Effect.tryPromise`
wrappers and the transaction bridge in `src/server/db/client.ts`.
