import '@tanstack/react-start/server-only'
import { sql } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'
import { Database } from './client.ts'
import { type DbError, query } from './query.ts'

/** Whether Postgres answers (GET /api/ready). Kept apart from the repositories, so readiness needs no feature. */
export class DatabaseHealth extends Context.Service<DatabaseHealth, { readonly ping: Effect.Effect<void, DbError> }>()(
  'app/DatabaseHealth',
) {
  static readonly layer = Layer.effect(
    DatabaseHealth,
    Effect.gen(function* () {
      const db = yield* Database
      return { ping: Effect.asVoid(query(db, (client) => client.execute(sql`select 1`))) }
    }),
  )
}
