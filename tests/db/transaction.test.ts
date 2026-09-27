// Database.transaction (src/server/db/client.ts) against real Postgres: commit, rollback on a typed failure, a
// defect and an interruption, and nested use joining the outer transaction. The writes go through PostsRepo,
// so this also proves that a repository built outside the transaction sends its statements inside it.
import { drizzle } from 'drizzle-orm/node-postgres'
import { Cause, Data, Deferred, Effect, Exit, Fiber, Layer } from 'effect'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Database, pool } from '#/server/db/client.ts'
import * as schema from '#/server/db/schema/index.ts'
import { PostsRepo } from '#/server/posts/repo.ts'
import { createAccount } from './helpers.ts'

afterAll(() => pool.end())

const logged: string[] = []
const recordingDb = drizzle({ client: pool, schema, logger: { logQuery: (query) => void logged.push(query) } })
const layer = PostsRepo.layer.pipe(Layer.provideMerge(Layer.succeed(Database, recordingDb)))
const run = <A, E>(effect: Effect.Effect<A, E, PostsRepo | Database>) =>
  Effect.runPromiseExit(effect.pipe(Effect.provide(layer)))

class Refused extends Data.TaggedError('Refused')<{ readonly reason: string }> {}

let author: { id: string; name: string }
beforeAll(async () => {
  author = await createAccount('transaction')
})
beforeEach(() => {
  logged.length = 0
})

/** Bodies of `author`'s posts among `bodies` that are committed, read outside any transaction. */
const committed = async (...bodies: string[]) =>
  (
    await pool.query<{ body: string }>('select body from post where author_id = $1 and body = any($2) order by body', [
      author.id,
      bodies,
    ])
  ).rows.map((row) => row.body)

const publish = (...bodies: string[]) =>
  Effect.gen(function* () {
    const repo = yield* PostsRepo
    for (const body of bodies) yield* repo.create(author, body)
  })

const unique = (label: string) => `${label} ${crypto.randomUUID()}`
const control = () => logged.filter((sql) => /^(begin|commit|rollback|savepoint)/i.test(sql))
/** Every checked-out connection went back to the pool. */
const expectReleased = () => expect(pool.totalCount - pool.idleCount).toBe(0)

describe('Database.transaction', () => {
  it('commits every statement of a body that succeeds, and returns its value', async () => {
    const [a, b] = [unique('commit a'), unique('commit b')]
    const exit = await run(Database.transaction(publish(a, b).pipe(Effect.as('done'))))
    expect(exit).toEqual(Exit.succeed('done'))
    expect(await committed(a, b)).toEqual([a, b].toSorted())
    expect(control()).toEqual(['begin', 'commit'])
    expectReleased()
  })

  it('rolls back and fails with the same typed error', async () => {
    const body = unique('typed failure')
    const failed = await run(
      Database.transaction(
        publish(body).pipe(Effect.andThen(Effect.fail(new Refused({ reason: 'after the insert' })))),
      ).pipe(Effect.flip),
    )
    // Still a typed failure (not a defect): `flip` turns it into the success value.
    expect(Exit.isSuccess(failed) && failed.value).toEqual(new Refused({ reason: 'after the insert' }))
    expect(Exit.isSuccess(failed) && failed.value._tag).toBe('Refused')
    expect(await committed(body)).toEqual([])
    expect(control()).toEqual(['begin', 'rollback'])
    expectReleased()
  })

  it('rolls back on a defect and keeps the defect', async () => {
    const body = unique('defect')
    const defect = new Error('boom')
    const exit = await run(Database.transaction(publish(body).pipe(Effect.andThen(Effect.die(defect)))))
    expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true)
    expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toBe(defect)
    expect(await committed(body)).toEqual([])
    expectReleased()
  })

  it('isolates uncommitted writes and rolls back on interruption before the interrupt returns', async () => {
    const body = unique('interrupted')
    const exit = await run(
      Effect.gen(function* () {
        const written = yield* Deferred.make<boolean>()
        const fiber = yield* Effect.forkChild(
          Database.transaction(
            publish(body).pipe(Effect.andThen(Deferred.succeed(written, true)), Effect.andThen(Effect.never)),
          ),
        )
        yield* Deferred.await(written)
        // Written inside the transaction, invisible outside it.
        expect(yield* Effect.promise(() => committed(body))).toEqual([])
        yield* Fiber.interrupt(fiber)
        // No polling: the interrupt waited for the ROLLBACK.
        expect(control()).toEqual(['begin', 'rollback'])
        return yield* Fiber.await(fiber)
      }),
    )
    expect(Exit.isSuccess(exit) && Exit.isFailure(exit.value) && Cause.hasInterruptsOnly(exit.value.cause)).toBe(true)
    expect(await committed(body)).toEqual([])
    expectReleased()
  })

  it('joins the outer transaction when nested: one BEGIN, no savepoint, and an outer failure undoes both', async () => {
    const [inner, outer] = [unique('nested inner'), unique('nested outer')]
    const exit = await run(
      Database.transaction(
        Effect.gen(function* () {
          yield* Database.transaction(publish(inner))
          yield* publish(outer)
          return yield* new Refused({ reason: 'after both' })
        }),
      ),
    )
    expect(Exit.isFailure(exit)).toBe(true)
    expect(await committed(inner, outer)).toEqual([])
    expect(control()).toEqual(['begin', 'rollback'])

    // And when everything succeeds, the inner writes commit with the outer ones.
    logged.length = 0
    await run(Database.transaction(Effect.andThen(Database.transaction(publish(inner)), publish(outer))))
    expect(await committed(inner, outer)).toEqual([inner, outer].toSorted())
    expect(control()).toEqual(['begin', 'commit'])
    expectReleased()
  })

  it('leaves a repository outside a transaction on its own client, one statement per call', async () => {
    const body = unique('no transaction')
    await run(publish(body))
    expect(logged).toHaveLength(1)
    expect(await committed(body)).toEqual([body])
  })
})
