import '@tanstack/react-start/server-only'
import { sql } from 'drizzle-orm'
import { Context, Data, Effect, Layer } from 'effect'
import { Database } from './client.ts'

class DbError extends Data.TaggedError('DbError')<{ readonly cause: unknown }> {}

/** Whether Postgres answers (GET /api/ready). Kept apart from the repositories, so readiness needs no feature. */
export class DatabaseHealth extends Context.Service<DatabaseHealth, { readonly ping: Effect.Effect<void, DbError> }>()(
  'app/DatabaseHealth',
) {
  static readonly layer = Layer.effect(
    DatabaseHealth,
    Effect.gen(function* () {
      const db = yield* Database
      const ping = Effect.tryPromise({ try: () => db.execute(sql`select 1`), catch: (cause) => new DbError({ cause }) })
      return { ping: Effect.asVoid(ping) }
    }),
  )
}
