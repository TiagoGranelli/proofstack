import '@tanstack/react-start/server-only'
import type { ExtractTablesWithRelations } from 'drizzle-orm'
import { drizzle, type NodePgQueryResultHKT } from 'drizzle-orm/node-postgres'
import { PgTransaction, type PgDatabase } from 'drizzle-orm/pg-core'
import { Context, Effect, Exit, Layer, Option } from 'effect'
import { Pool } from 'pg'
import { env } from '../env.ts'
import { onShutdown } from '../lifecycle.ts'
import { log } from '../log.ts'
import * as schema from './schema/index.ts'

export const pool = new Pool({
  connectionString: env.databaseUrl,
  max: env.databasePoolMax,
  idleTimeoutMillis: 10_000,
  // Fail fast instead of queueing forever when Postgres is unreachable or the pool is exhausted,
  // so /api/ready reports 503 promptly and requests do not pile up.
  connectionTimeoutMillis: 5_000,
  // Server-side cap for a single statement; nothing in this app should come close.
  statement_timeout: 15_000,
  application_name: 'proofstack',
})
pool.on('error', (error) => log('error', 'postgres pool error', { error }))
onShutdown('postgres-pool', () => pool.end())

export const db = drizzle({ client: pool, schema })

/** The app's Drizzle client or one of its transactions: what a repository sends its statements through. */
export type Db = PgDatabase<NodePgQueryResultHKT, typeof schema, ExtractTablesWithRelations<typeof schema>>

/** Carries a failed Exit through Drizzle's callback, whose only way to roll back is a rejection. */
class Rollback extends Error {
  readonly exit: Exit.Exit<unknown, unknown>
  constructor(exit: Exit.Exit<unknown, unknown>) {
    super('transaction rolled back')
    this.exit = exit
  }
}

/**
 * The Drizzle client as an Effect service, so repositories can be built against another database in tests.
 * Repositories take their client per statement from `Database.client`, so a transaction reaches them.
 */
export class Database extends Context.Service<Database, Db>()('proofstack/Database') {
  static readonly layer = Layer.succeed(Database, db)

  /**
   * The client for one statement: the transaction `Database.transaction` provides as `Database`, or `own`
   * (the client the repository was built with) outside one.
   */
  static readonly client = (own: Db): Effect.Effect<Db> =>
    Effect.map(
      Effect.serviceOption(Database),
      Option.getOrElse(() => own),
    )

  /**
   * Runs `effect` in one transaction, with `Database` provided as the transaction. It commits when `effect`
   * succeeds and rolls back when it fails, dies or is interrupted; the failure comes out unchanged (typed
   * errors stay typed). Inside another transaction it joins that one: no savepoint, one commit or rollback for
   * all of it. BEGIN or COMMIT failing (the database is gone) is a defect, as every database failure of a
   * handler is.
   */
  static readonly transaction = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R | Database> =>
    Effect.gen(function* () {
      const database = yield* Database
      if (database instanceof PgTransaction) return yield* effect
      const context = yield* Effect.context<R>()
      return yield* Effect.callback<A, E>((resume) => {
        // The body runs as its own fiber inside Drizzle's callback; interrupting the caller interrupts it.
        const controller = new AbortController()
        const settled = database
          .transaction(async (tx) => {
            const exit = await Effect.runPromiseExitWith(Context.add(context, Database, tx))(effect, {
              signal: controller.signal,
            })
            if (Exit.isFailure(exit)) throw new Rollback(exit)
            return exit
          })
          .then(
            (exit): Exit.Exit<A, E> => exit,
            // A Rollback holds the body's own Exit, so its type is `Exit<A, E>`.
            (error: unknown) => (error instanceof Rollback ? (error.exit as Exit.Exit<A, E>) : Exit.die(error)),
          )
        void settled.then(resume)
        // On interruption, wait for the ROLLBACK, so the caller never outlives its transaction.
        return Effect.promise(() => {
          controller.abort()
          return settled
        }).pipe(Effect.asVoid)
      })
    })
}
