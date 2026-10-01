// Handler branching for the posts groups, through the real contract with an in-memory repository and a
// fake session store (tests/api/harness.ts). The database-backed behavior (SQL, ownership in the WHERE
// clause, rate limits, CSRF) is covered by tests/integration against the running app.
import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { PostId } from '#/contract/ids.ts'
import { WRITE_WINDOW_SECONDS, WRITES_PER_WINDOW, POSTS_PAGE_DEFAULT, POSTS_PAGE_MAX } from '#/contract/limits.ts'
import type { PageCursor } from '#/contract/pages.ts'
import type { PostPage } from '#/contract/posts.ts'
import { apiLayer, authors, clientAs } from './harness.ts'

const MISSING_ID = PostId.make('00000000-0000-4000-8000-000000000000')
/** A list request without `cursor` or `limit`: the first page at the default size. */
const firstPage = { query: {} }

describe('myPosts', () => {
  it.effect('creates a post for the signed-in author and lists only theirs', () =>
    Effect.gen(function* () {
      const [alice, bob] = [yield* clientAs('alice'), yield* clientAs('bob')]
      const mine = yield* alice.myPosts.create({ payload: { body: 'hello from alice' } })
      assert.strictEqual(mine.authorName, authors.alice.name)
      assert.strictEqual(mine.createdAt, mine.updatedAt)
      const theirs = yield* bob.myPosts.create({ payload: { body: 'hello from bob' } })
      assert.strictEqual(theirs.authorName, authors.bob.name)

      assert.deepStrictEqual(yield* alice.myPosts.list(firstPage), { items: [mine], nextCursor: null })
      assert.deepStrictEqual(yield* bob.myPosts.list(firstPage), { items: [theirs], nextCursor: null })
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
      assert.deepStrictEqual(yield* alice.myPosts.list(firstPage), { items: [updated], nextCursor: null })
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
      assert.deepStrictEqual(yield* alice.myPosts.list(firstPage), { items: [], nextCursor: null })

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

      for (const id of [bobs.id, MISSING_ID, PostId.make('not-a-uuid')]) {
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

      assert.deepStrictEqual(yield* bob.myPosts.list(firstPage), { items: [bobs], nextCursor: null })
    }).pipe(Effect.provide(apiLayer())),
  )

  // Every myPosts endpoint sits behind Authentication, which runs before request validation.
  it.effect.each(['none', 'forged'] as const)('answers 401 on every endpoint with session %s', (token) =>
    Effect.gen(function* () {
      const anonymous = yield* clientAs(token)
      const responses = [
        yield* anonymous.myPosts.list({ ...firstPage, responseMode: 'response-only' }),
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

  // Create, edit and delete share one bucket per user; refused writes change nothing; reads are not counted.
  it.effect('answers 429 past the write limit, per user, and keeps reading', () =>
    Effect.gen(function* () {
      const [alice, bob] = [yield* clientAs('alice'), yield* clientAs('bob')]
      for (let i = 3; i < WRITES_PER_WINDOW; i++) yield* alice.myPosts.create({ payload: { body: `post ${i}` } })
      const post = yield* alice.myPosts.create({ payload: { body: 'kept' } })
      yield* alice.myPosts.update({ params: { id: post.id }, payload: { body: 'edited' } })
      // A write that finds nothing still counts.
      yield* alice.myPosts.remove({ params: { id: MISSING_ID } }).pipe(Effect.flip)

      for (const [index, response] of [
        yield* alice.myPosts.create({ payload: { body: 'one too many' }, responseMode: 'response-only' }),
        yield* alice.myPosts.update({
          params: { id: post.id },
          payload: { body: 'overwritten' },
          responseMode: 'response-only',
        }),
        yield* alice.myPosts.remove({ params: { id: post.id }, responseMode: 'response-only' }),
        // Counted before the body is read, so an invalid one is refused the same way.
        yield* alice.myPosts.update({ params: { id: post.id }, payload: { body: 'x' }, responseMode: 'response-only' }),
      ].entries()) {
        assert.strictEqual(response.status, 429)
        // The wait the store computed (see the harness's clock), not a fixed stand-in such as the whole window.
        assert.deepStrictEqual(yield* response.json, {
          _tag: 'RateLimited',
          message: 'Too many changes in a short time',
          retryAfter: WRITE_WINDOW_SECONDS - 1 - index,
        })
      }

      const [newest] = (yield* alice.myPosts.list(firstPage)).items
      assert.deepStrictEqual([newest?.id, newest?.body], [post.id, 'edited'])
      assert.strictEqual((yield* bob.myPosts.create({ payload: { body: 'bob is not limited' } })).authorName, 'Bob')
    }).pipe(Effect.provide(apiLayer())),
  )
})

describe('publicPosts', () => {
  it.effect('lists every author’s posts, newest first, without a session', () =>
    Effect.gen(function* () {
      const [alice, bob, anonymous] = [yield* clientAs('alice'), yield* clientAs('bob'), yield* clientAs('none')]
      yield* alice.myPosts.create({ payload: { body: 'first' } })
      yield* bob.myPosts.create({ payload: { body: 'second' } })
      const page = yield* anonymous.publicPosts.list(firstPage)
      assert.strictEqual(page.nextCursor, null)
      assert.deepStrictEqual(
        page.items.map((p) => [p.body, p.authorName]),
        [
          ['second', 'Bob'],
          ['first', 'Alice'],
        ],
      )
    }).pipe(Effect.provide(apiLayer())),
  )

  it.effect(`returns the newest ${POSTS_PAGE_DEFAULT} by default and at most ${POSTS_PAGE_MAX} on request`, () =>
    Effect.gen(function* () {
      const [alice, anonymous] = [yield* clientAs('alice'), yield* clientAs('none')]
      for (let i = 0; i < POSTS_PAGE_MAX + 1; i++) yield* alice.myPosts.create({ payload: { body: `post ${i}` } })

      const byDefault = yield* anonymous.publicPosts.list(firstPage)
      assert.strictEqual(byDefault.items.length, POSTS_PAGE_DEFAULT)
      assert.strictEqual(byDefault.items[0]?.body, `post ${POSTS_PAGE_MAX}`)
      assert.isNotNull(byDefault.nextCursor)

      const largest = yield* anonymous.publicPosts.list({ query: { limit: POSTS_PAGE_MAX } })
      assert.strictEqual(largest.items.length, POSTS_PAGE_MAX)
      assert.strictEqual(largest.items[0]?.body, `post ${POSTS_PAGE_MAX}`)
      assert.strictEqual(largest.items.at(-1)?.body, 'post 1')

      const rest = yield* anonymous.publicPosts.list({ query: { cursor: largest.nextCursor!, limit: POSTS_PAGE_MAX } })
      assert.deepStrictEqual(
        rest.items.map((p) => p.body),
        ['post 0'],
      )
      assert.strictEqual(rest.nextCursor, null)
    }).pipe(Effect.provide(apiLayer())),
  )
})

/** The bodies on each page of a list, following `nextCursor` until it is null. */
const allPages = (
  list: (page: { query: { cursor?: PageCursor; limit: number } }) => Effect.Effect<PostPage, unknown>,
  limit: number,
) =>
  Effect.gen(function* () {
    const pages: string[][] = []
    let cursor: PageCursor | undefined
    do {
      const page = yield* list({ query: cursor ? { cursor, limit } : { limit } })
      pages.push(page.items.map((p) => p.body))
      cursor = page.nextCursor ?? undefined
    } while (cursor)
    return pages
  })

const bodies = (count: number) => Array.from({ length: count }, (_, i) => `post ${count - 1 - i}`)

describe('pagination', () => {
  // Default clock (one second apart), same millisecond (equal `createdAt` on the wire, so a cursor built from
  // it would skip or repeat posts) and same instant (only the id orders them).
  it.effect.each([
    ['a second', 1_000_000],
    ['a microsecond', 1],
    ['no time', 0],
  ] as const)('pages through posts %s apart without skipping or repeating one', ([, clockStepMicros]) =>
    Effect.gen(function* () {
      const [alice, anonymous] = [yield* clientAs('alice'), yield* clientAs('none')]
      for (let i = 0; i < 7; i++) yield* alice.myPosts.create({ payload: { body: `post ${i}` } })

      const pages = yield* allPages(anonymous.publicPosts.list, 3)
      assert.deepStrictEqual(
        pages.map((page) => page.length),
        [3, 3, 1],
      )
      const seen = pages.flat()
      assert.sameMembers(seen, bodies(7))
      assert.strictEqual(new Set(seen).size, 7)
      if (clockStepMicros > 0) assert.deepStrictEqual(seen, bodies(7))
    }).pipe(Effect.provide(apiLayer({ clockStepMicros }))),
  )

  it.effect('ends with nextCursor null when the last page is exactly full', () =>
    Effect.gen(function* () {
      const [alice, anonymous] = [yield* clientAs('alice'), yield* clientAs('none')]
      for (let i = 0; i < 4; i++) yield* alice.myPosts.create({ payload: { body: `post ${i}` } })
      assert.deepStrictEqual(yield* allPages(anonymous.publicPosts.list, 2), [
        ['post 3', 'post 2'],
        ['post 1', 'post 0'],
      ])
    }).pipe(Effect.provide(apiLayer())),
  )

  it.effect('keeps later pages stable while new posts are published', () =>
    Effect.gen(function* () {
      const [alice, anonymous] = [yield* clientAs('alice'), yield* clientAs('none')]
      for (let i = 0; i < 4; i++) yield* alice.myPosts.create({ payload: { body: `post ${i}` } })
      const first = yield* anonymous.publicPosts.list({ query: { limit: 2 } })
      yield* alice.myPosts.create({ payload: { body: 'newer' } })
      const second = yield* anonymous.publicPosts.list({ query: { cursor: first.nextCursor!, limit: 2 } })
      assert.deepStrictEqual(
        second.items.map((p) => p.body),
        ['post 1', 'post 0'],
      )
      assert.strictEqual(second.nextCursor, null)
    }).pipe(Effect.provide(apiLayer())),
  )

  it.effect('pages only through the signed-in author’s posts', () =>
    Effect.gen(function* () {
      const [alice, bob] = [yield* clientAs('alice'), yield* clientAs('bob')]
      for (let i = 0; i < 3; i++) {
        yield* alice.myPosts.create({ payload: { body: `post ${i}` } })
        yield* bob.myPosts.create({ payload: { body: `bob ${i}` } })
      }
      assert.deepStrictEqual(yield* allPages(alice.myPosts.list, 2), [['post 2', 'post 1'], ['post 0']])
    }).pipe(Effect.provide(apiLayer())),
  )
})
