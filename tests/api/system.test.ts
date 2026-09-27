// Liveness and readiness handlers over the in-memory repository (tests/api/harness.ts).
import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { apiLayer, clientAs } from './harness.ts'

describe('system', () => {
  it.effect('health and ready answer ok while the database answers', () =>
    Effect.gen(function* () {
      const client = yield* clientAs('none')
      assert.deepStrictEqual(yield* client.system.health(), { status: 'ok' })
      assert.deepStrictEqual(yield* client.system.ready(), { status: 'ok' })
    }).pipe(Effect.provide(apiLayer())),
  )

  it.effect('ready answers 503 ServiceUnavailable without leaking the database error; health stays ok', () =>
    Effect.gen(function* () {
      const client = yield* clientAs('none')
      const error = yield* client.system.ready().pipe(Effect.flip)
      assert.strictEqual(error._tag, 'ServiceUnavailable')
      assert.strictEqual(error.message, 'Database unavailable')
      assert.deepStrictEqual(yield* client.system.health(), { status: 'ok' })
    }).pipe(Effect.provide(apiLayer({ databaseDown: true }))),
  )
})
