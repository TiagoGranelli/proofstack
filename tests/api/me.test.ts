// GET /api/me through the typed client (tests/api/harness.ts): the session's user, or 401.
import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { apiLayer, authors, clientAs } from './harness.ts'

describe('me', () => {
  it.effect('answers the signed-in user', () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* (yield* clientAs('alice')).me.get(), authors.alice)
      assert.deepStrictEqual(yield* (yield* clientAs('bob')).me.get(), authors.bob)
    }).pipe(Effect.provide(apiLayer())),
  )

  it.effect.each(['none', 'forged'] as const)('answers 401 with session %s', (token) =>
    Effect.gen(function* () {
      const response = yield* (yield* clientAs(token)).me.get({ responseMode: 'response-only' })
      assert.strictEqual(response.status, 401)
      assert.deepStrictEqual(yield* response.json, { _tag: 'Unauthorized', message: 'Authentication required' })
    }).pipe(Effect.provide(apiLayer())),
  )
})
