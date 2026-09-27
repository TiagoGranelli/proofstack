// Database.transaction's bookkeeping over a fake driver that records BEGIN/COMMIT/ROLLBACK like Drizzle's: which
// client a body sees, and what it returns. tests/db/transaction.test.ts proves the same against Postgres.
import { PgTransaction } from 'drizzle-orm/pg-core'
import { Cause, Data, Effect, Exit } from 'effect'
import { describe, expect, it } from 'vitest'
import { Database, type Db } from '#/server/db/client.ts'

class Refused extends Data.TaggedError('Refused') {}

const fakeDriver = () => {
  const log: string[] = []
  const tx = Object.create(PgTransaction.prototype) as Db
  const own = {
    transaction: async (body: (client: Db) => Promise<unknown>) => {
      log.push('begin')
      try {
        const returned = await body(tx)
        log.push('commit')
        return returned
      } catch (error) {
        log.push('rollback')
        throw error
      }
    },
  } as unknown as Db
  return { log, own, tx }
}

const run = <A, E>(own: Db, effect: Effect.Effect<A, E, Database>) =>
  Effect.runPromiseExit(effect.pipe(Effect.provideService(Database, own)))

describe('Database.transaction', () => {
  it('gives the body the transaction as Database and as the client of a repository built outside it', async () => {
    const { log, own, tx } = fakeDriver()
    const seen = await run(
      own,
      Database.transaction(
        Effect.gen(function* () {
          return [yield* Database, yield* Database.client(own)]
        }),
      ),
    )
    expect(seen).toEqual(Exit.succeed([tx, tx]))
    expect(log).toEqual(['begin', 'commit'])
    expect(await Effect.runPromise(Database.client(own))).toBe(own)
  })

  it('rolls back and keeps the typed error; a driver failure is a defect', async () => {
    const { log, own } = fakeDriver()
    expect(await run(own, Database.transaction(Effect.fail(new Refused())))).toEqual(Exit.fail(new Refused()))
    expect(log).toEqual(['begin', 'rollback'])
    const broken = {
      transaction: () => Promise.reject(new Error('connection refused')),
    } as unknown as Db
    const exit = await run(broken, Database.transaction(Effect.succeed(1)))
    expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true)
  })

  it('joins a transaction it is already in', async () => {
    const { log, own } = fakeDriver()
    await run(own, Database.transaction(Database.transaction(Effect.void)))
    expect(log).toEqual(['begin', 'commit'])
  })
})
