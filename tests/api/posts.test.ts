// Handler branching for the posts groups, through the real contract with an in-memory repository and a
// fake session store (tests/api/harness.ts). The database-backed behavior (SQL, ownership in the WHERE
// clause, rate limits, CSRF) is covered by tests/integration against the running app.
import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { apiLayer, authors, clientAs } from './harness.ts'

const MISSING_ID = '00000000-0000-4000-8000-000000000000'

describe('myPosts', () => {
  it.effect('creates a post for the signed-in author and lists only theirs', () =>
    Effect.gen(function* () {
      const [alice, bob] = [yield* clientAs('alice'), yield* clientAs('bob')]
      const mine = yield* alice.myPosts.create({ payload: { body: 'hello from alice' } })
      assert.strictEqual(mine.authorName, authors.alice.name)
      assert.strictEqual(mine.createdAt, mine.updatedAt)
      const theirs = yield* bob.myPosts.create({ payload: { body: 'hello from bob' } })
      assert.strictEqual(theirs.authorName, authors.bob.name)

      assert.deepStrictEqual(yield* alice.myPosts.list(), [mine])
      assert.deepStrictEqual(yield* bob.myPosts.list(), [theirs])
    }).pipe(Effect.provide(apiLayer())),
  )

  it.effect('answers 201 with the created post', () =>
    Effect.gen(function* () {
      const alice = yield* clientAs('alice')
      const [post, response] = yield* alice.myPosts.create({
        payload: { body: 'status' },
        responseMode: 'decoded-and-response',
      })
      assert.strictEqual(response.status, 201)
      assert.strictEqual(post.body, 'status')
    }).pipe(Effect.provide(apiLayer())),
  )

  it.effect('updates the author’s own post and marks it edited', () =>
    Effect.gen(function* () {
      const alice = yield* clientAs('alice')
      const created = yield* alice.myPosts.create({ payload: { body: 'draft' } })
      const updated = yield* alice.myPosts.update({ params: { id: created.id }, payload: { body: 'final' } })
      assert.deepStrictEqual({ ...updated, updatedAt: created.updatedAt }, { ...created, body: 'final' })
      assert.notStrictEqual(updated.updatedAt, created.updatedAt)
      assert.deepStrictEqual(yield* alice.myPosts.list(), [updated])
    }).pipe(Effect.provide(apiLayer())),
  )

  it.effect('deletes the author’s own post with 204, and a second delete is PostNotFound', () =>
    Effect.gen(function* () {
      const alice = yield* clientAs('alice')
      const created = yield* alice.myPosts.create({ payload: { body: 'short-lived' } })
      const [, response] = yield* alice.myPosts.remove({
        params: { id: created.id },
        responseMode: 'decoded-and-response',
      })
      assert.strictEqual(response.status, 204)
      assert.deepStrictEqual(yield* alice.myPosts.list(), [])

      const again = yield* alice.myPosts.remove({ params: { id: created.id } }).pipe(Effect.flip)
      assert.strictEqual(again._tag, 'PostNotFound')
    }).pipe(Effect.provide(apiLayer())),
  )

  // Another author's post must be indistinguishable from a missing one: same tag, same status, the id echoed
  // back, and the post left untouched. The path id is a plain string in the contract, so the typed client
  // can also send one that is not a UUID.
  it.effect('treats another author’s post exactly like a missing one', () =>
    Effect.gen(function* () {
      const [alice, bob] = [yield* clientAs('alice'), yield* clientAs('bob')]
      const bobs = yield* bob.myPosts.create({ payload: { body: 'bob only' } })

      for (const id of [bobs.id, MISSING_ID, 'not-a-uuid']) {
        for (const [call, response] of [
          [
            'update',
            yield* alice.myPosts.update({ params: { id }, payload: { body: 'hijack' }, responseMode: 'response-only' }),
          ],
          ['remove', yield* alice.myPosts.remove({ params: { id }, responseMode: 'response-only' })],
        ] as const) {
          assert.strictEqual(response.status, 404, `${call} ${JSON.stringify(id)}`)
          assert.deepStrictEqual(yield* response.json, { _tag: 'PostNotFound', id }, `${call} ${JSON.stringify(id)}`)
        }
      }

      assert.deepStrictEqual(yield* bob.myPosts.list(), [bobs])
    }).pipe(Effect.provide(apiLayer())),
  )

  // Every myPosts endpoint sits behind Authentication, which runs before request validation.
  it.effect.each(['none', 'forged'] as const)('answers 401 on every endpoint with session %s', (token) =>
    Effect.gen(function* () {
      const anonymous = yield* clientAs(token)
      const responses = [
        yield* anonymous.myPosts.list({ responseMode: 'response-only' }),
        yield* anonymous.myPosts.create({ payload: { body: 'x' }, responseMode: 'response-only' }),
        yield* anonymous.myPosts.update({
          params: { id: MISSING_ID },
          payload: { body: 'x' },
          responseMode: 'response-only',
        }),
        yield* anonymous.myPosts.remove({ params: { id: MISSING_ID }, responseMode: 'response-only' }),
      ]
      for (const response of responses) {
        assert.strictEqual(response.status, 401)
        assert.deepStrictEqual(yield* response.json, { _tag: 'Unauthorized', message: 'Authentication required' })
      }
    }).pipe(Effect.provide(apiLayer())),
  )
})

describe('publicPosts', () => {
  it.effect('lists every author’s posts, newest first, without a session', () =>
    Effect.gen(function* () {
      const [alice, bob, anonymous] = [yield* clientAs('alice'), yield* clientAs('bob'), yield* clientAs('none')]
      yield* alice.myPosts.create({ payload: { body: 'first' } })
      yield* bob.myPosts.create({ payload: { body: 'second' } })
      const list = yield* anonymous.publicPosts.list()
      assert.deepStrictEqual(
        list.map((p) => [p.body, p.authorName]),
        [
          ['second', 'Bob'],
          ['first', 'Alice'],
        ],
      )
    }).pipe(Effect.provide(apiLayer())),
  )

  it.effect('returns one page of at most 50 posts, the newest', () =>
    Effect.gen(function* () {
      const [alice, anonymous] = [yield* clientAs('alice'), yield* clientAs('none')]
      for (let i = 0; i < 51; i++) yield* alice.myPosts.create({ payload: { body: `post ${i}` } })
      const list = yield* anonymous.publicPosts.list()
      assert.strictEqual(list.length, 50)
      assert.strictEqual(list[0]?.body, 'post 50')
      assert.strictEqual(list.at(-1)?.body, 'post 1')
    }).pipe(Effect.provide(apiLayer())),
  )
})
