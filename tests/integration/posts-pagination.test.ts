// Cursor pagination of GET /api/posts and GET /api/me/posts against the running app (`pnpm verify:app`).
// Other files add and delete posts concurrently, so every assertion is either about posts this file created
// or about invariants that hold for any single request (a page is one SELECT).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { myPostsCreate, myPostsList, myPostsRemove, publicPostsList } from '#/sdk/sdk.gen.ts'
import type { Post, PostPage } from '#/sdk/types.gen.ts'
import { clientIps, createUser, sdkClient, signIn } from './helpers.ts'

const nextIp = clientIps('100.64.30')
const anonymous = sdkClient()
type Client = ReturnType<typeof sdkClient>
let author: Client
let other: Client
const created: Array<{ client: Client; id: string }> = []

// Accounts of this file alone: it publishes and deletes dozens of posts, which the shared users' write limit
// (src/server/api/rate-limit.ts) would have to absorb together with every other file's writes.
let authorName: string
beforeAll(async () => {
  const [mine, theirs] = await Promise.all([createUser('pagination'), createUser('pagination-other')])
  authorName = mine.name
  author = sdkClient(await signIn(mine, nextIp()))
  other = sdkClient(await signIn(theirs, nextIp()))
})

afterAll(async () => {
  await Promise.all(created.map(({ client, id }) => myPostsRemove({ client, path: { id } })))
})

const tag = crypto.randomUUID().slice(0, 8)

/** Publishes posts one after another (distinct timestamps), oldest first. */
const publish = async (client: Client, label: string, count: number) => {
  const posts: Post[] = []
  for (let i = 0; i < count; i++) {
    const res = await myPostsCreate({ client, body: { body: `pagination ${tag} ${label} ${i}` } })
    expect(res.response?.status).toBe(201)
    posts.push(res.data!)
    created.push({ client, id: res.data!.id })
  }
  return posts
}

type Query = { cursor?: string; limit?: string }
const publicPage = async (query: Query) => {
  const res = await publicPostsList({ client: anonymous, query })
  expect(res.response?.status, JSON.stringify(res.error)).toBe(200)
  return res.data!
}
const myPage = async (client: Client, query: Query) => {
  const res = await myPostsList({ client, query })
  expect(res.response?.status, JSON.stringify(res.error)).toBe(200)
  return res.data!
}

/**
 * Follows `nextCursor` from the first page until `done` says stop or the list ends. `between` runs after each
 * page, before the next request (to publish concurrently with the walk).
 */
const walk = async (
  fetchPage: (query: Query) => Promise<PostPage>,
  limit: number,
  options: { done?: (seen: Post[]) => boolean; between?: (page: number) => Promise<void> } = {},
) => {
  const pages: PostPage[] = []
  let cursor: string | undefined
  for (let n = 0; n < 200; n++) {
    const page = await fetchPage({ limit: String(limit), ...(cursor ? { cursor } : {}) })
    pages.push(page)
    const seen = pages.flatMap((p) => p.items)
    if (!page.nextCursor || options.done?.(seen)) return pages
    await options.between?.(n)
    cursor = page.nextCursor
  }
  throw new Error('the list did not end after 200 pages')
}

/** Every full page (one with a next cursor) holds exactly `limit` posts; the last one at most `limit`. */
const expectPageSizes = (pages: PostPage[], limit: number) => {
  for (const page of pages.slice(0, -1)) {
    expect(page.nextCursor).toEqual(expect.any(String))
    expect(page.items).toHaveLength(limit)
  }
  expect(pages.at(-1)!.items.length).toBeLessThanOrEqual(limit)
}

/** Newest first: createdAt never increases (it is rounded to milliseconds, so equal values are allowed). */
const expectNewestFirst = (posts: Post[]) => {
  const times = posts.map((p) => Date.parse(p.createdAt))
  expect(times).toEqual(times.toSorted((a, b) => b - a))
}

const ids = (posts: Post[]) => posts.map((p) => p.id)

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')

/** The cursor after the first `count` posts, in pages of at most 50. */
const cursorAfter = async (count: number) => {
  let cursor: string | undefined
  for (let left = count; left > 0; left -= 50) {
    const page = await publicPage({ limit: String(Math.min(left, 50)), ...(cursor ? { cursor } : {}) })
    cursor = page.nextCursor ?? undefined
  }
  return cursor!
}

describe('limit', () => {
  it('defaults to 20 and accepts 1 to 50', async () => {
    await publish(author, 'limit', 2)
    const byDefault = await publicPage({})
    expect(byDefault.items.length).toBeLessThanOrEqual(20)
    for (const limit of [1, 2, 50]) {
      const page = await publicPage({ limit: String(limit) })
      expect(page.items.length).toBeLessThanOrEqual(limit)
      expect(page.items.length).toBeGreaterThanOrEqual(Math.min(limit, 2))
    }
    expect((await publicPage({ limit: '1' })).nextCursor).toEqual(expect.any(String))
  })

  it.each(['0', '51', '-1', '1.5', '1e1', ' 5', 'abc', ''])('rejects limit=%j with a 400', async (limit) => {
    for (const res of [
      await publicPostsList({ client: anonymous, query: { limit } }),
      await myPostsList({ client: author, query: { limit } }),
    ]) {
      expect(res.response?.status).toBe(400)
      expect(res.error).toMatchObject({ _tag: 'ValidationError', issues: [{ path: ['limit'] }] })
    }
  })
})

describe('cursor', () => {
  const validId = '00000000-0000-4000-8000-000000000000'

  it.each([
    ['not base64url', '!!!'],
    ['not JSON', 'garbage'],
    ['empty', ''],
    ['the wrong JSON shape', encode(['2026-01-01T00:00:00.000000Z', validId])],
    ['a missing id', encode({ createdAt: '2026-01-01T00:00:00.000000Z' })],
    ['an id that is not a UUID', encode({ createdAt: '2026-01-01T00:00:00.000000Z', id: "1' or '1'='1" })],
    ['millisecond precision', encode({ createdAt: '2026-01-01T00:00:00.000Z', id: validId })],
    ['a time zone offset', encode({ createdAt: '2026-01-01T00:00:00.000000+01:00', id: validId })],
    ['an impossible date', encode({ createdAt: '2026-02-30T00:00:00.000000Z', id: validId })],
    ['year 0, which Postgres rejects', encode({ createdAt: '0000-01-01T00:00:00.000000Z', id: validId })],
    ['SQL in the timestamp', encode({ createdAt: "now()'); drop table post; --", id: validId })],
    // Postgres's ::timestamptz would read past the Z and fail the query if the pattern let this through.
    ['text after the Z', encode({ createdAt: '2026-01-01T00:00:00.000000Zjunk', id: validId })],
    ['month 13', encode({ createdAt: '2026-13-01T00:00:00.000000Z', id: validId })],
  ])('rejects a cursor with %s as a 400, never a 500', async (_, cursor) => {
    for (const res of [
      await publicPostsList({ client: anonymous, query: { cursor } }),
      await myPostsList({ client: author, query: { cursor } }),
    ]) {
      expect(res.response?.status).toBe(400)
      expect(res.error).toMatchObject({ _tag: 'ValidationError', message: 'Invalid request query' })
      const issues = (res.error as { issues: Array<{ path: string[] }> }).issues
      expect(issues.length).toBeGreaterThan(0)
      for (const issue of issues) expect(issue.path[0]).toBe('cursor')
    }
  })

  // Every key the schema admits must also be one Postgres accepts (::timestamptz, ::uuid): a 200, never a 500.
  it.each([
    '0001-01-01T00:00:00.000000Z',
    '2026-10-31T23:59:59.999999Z',
    '2026-11-30T00:00:00.000001Z',
    '2026-12-31T12:00:00.500000Z',
    '2028-02-29T00:00:00.000000Z',
    '9999-12-31T23:59:59.999999Z',
  ])('answers a page for the valid key %s', async (createdAt) => {
    for (const id of [validId, 'FFFFFFFF-FFFF-8FFF-BFFF-FFFFFFFFFFFF']) {
      for (const res of [
        await publicPostsList({ client: anonymous, query: { cursor: encode({ createdAt, id }) } }),
        await myPostsList({ client: author, query: { cursor: encode({ createdAt, id }) } }),
      ])
        expect(res.response?.status, `${createdAt} ${id}: ${JSON.stringify(res.error)}`).toBe(200)
    }
  })

  it('treats any well-formed key as a position, so edited cursors reveal nothing', async () => {
    const past = encode({ createdAt: '0001-01-01T00:00:00.000000Z', id: validId })
    expect(await publicPage({ cursor: past })).toEqual({ items: [], nextCursor: null })
    expect(await myPage(author, { cursor: past })).toEqual({ items: [], nextCursor: null })

    // A key from the far future starts before every post, like the first page, but still only the author's.
    const theirs = await publish(other, 'future-key', 1)
    const future = encode({ createdAt: '9999-12-31T23:59:59.999999Z', id: validId })
    const mine = await myPage(author, { cursor: future, limit: '50' })
    expect(ids(mine.items)).not.toContain(theirs[0]!.id)
    expect(new Set(mine.items.map((p) => p.authorName))).toEqual(new Set([authorName]))
  })
})

describe('paging', () => {
  it('walks the public list newest first, without gaps or repeats, while posts are published', async () => {
    const seeded = await publish(author, 'walk', 7)
    const seededIds = new Set(ids(seeded))
    const lateIds = new Set<string>()
    const pages = await walk(publicPage, 3, {
      done: (seen) => [...seededIds].every((id) => ids(seen).includes(id)),
      // After each page, another post goes to the top of the list, which must not shift the next pages.
      between: async () => {
        const [late] = await publish(other, 'during-walk', 1)
        lateIds.add(late!.id)
      },
    })
    const seen = pages.flatMap((p) => p.items)
    expectPageSizes(pages, 3)
    expectNewestFirst(seen)
    expect(new Set(ids(seen)).size).toBe(seen.length)
    // Every seeded post exactly once, newest first.
    expect(ids(seen).filter((id) => seededIds.has(id))).toEqual(ids(seeded).toReversed())
    // Posts published during the walk are newer than every cursor after the first page.
    expect(ids(pages.slice(1).flatMap((p) => p.items)).filter((id) => lateIds.has(id))).toEqual([])
    expect(lateIds.size).toBeGreaterThan(0)
  })

  it('resumes strictly after the cursor, also for posts created in the same instant', async () => {
    // Published concurrently: timestamps can collide at millisecond precision, and the id breaks ties.
    const burst = await Promise.all(
      Array.from({ length: 6 }, async (_, i) => {
        const res = await myPostsCreate({ client: author, body: { body: `pagination ${tag} burst ${i}` } })
        expect(res.response?.status).toBe(201)
        created.push({ client: author, id: res.data!.id })
        return res.data!
      }),
    )
    const burstIds = new Set(ids(burst))
    for (const limit of [1, 2, 4]) {
      const pages = await walk((query) => myPage(author, query), limit, {
        done: (seen) => [...burstIds].every((id) => ids(seen).includes(id)),
      })
      const seen = ids(pages.flatMap((p) => p.items))
      expectPageSizes(pages, limit)
      expect(new Set(seen).size).toBe(seen.length)
      expect(seen.filter((id) => burstIds.has(id)).toSorted()).toEqual([...burstIds].toSorted())
    }
  })

  it('ends with nextCursor null exactly when no post is left', async () => {
    await publish(author, 'end', 3)
    // Other files publish and delete concurrently; when that moved the tail between the walk and the check,
    // the whole check runs again.
    for (let attempt = 1; ; attempt++) {
      const pages = await walk(publicPage, 50)
      expectPageSizes(pages, 50)
      expect(pages.at(-1)!.nextCursor).toBeNull()
      const all = pages.flatMap((p) => p.items)
      // A page that ends exactly at the last post says there is no next page (the server reads limit + 1).
      const cursor = await cursorAfter(all.length - 3)
      const [exact, short] = await Promise.all([publicPage({ cursor, limit: '3' }), publicPage({ cursor, limit: '2' })])
      if (ids(exact.items).join() !== ids(all.slice(-3)).join() && attempt < 5) continue
      expect(exact).toEqual({ items: all.slice(-3), nextCursor: null })
      expect(short.items).toEqual(all.slice(-3, -1))
      expect(short.nextCursor).toEqual(expect.any(String))
      return
    }
  })
})

describe('author isolation across pages', () => {
  it("never pages into another author's posts", async () => {
    const mine = await publish(author, 'isolation-mine', 3)
    const theirs = await publish(other, 'isolation-theirs', 3)
    for (const [client, own, foreign] of [
      [author, mine, theirs],
      [other, theirs, mine],
    ] as const) {
      const ownIds = new Set(ids(own))
      const pages = await walk((query) => myPage(client, query), 2, {
        done: (seen) => [...ownIds].every((id) => ids(seen).includes(id)),
      })
      const seen = ids(pages.flatMap((p) => p.items))
      for (const post of foreign) expect(seen).not.toContain(post.id)
      expect(seen.filter((id) => ownIds.has(id))).toEqual(ids(own).toReversed())
    }

    // A cursor taken from one author's list is only a position in the other's list.
    const first = await myPage(author, { limit: '1' })
    const across = await myPage(other, { cursor: first.nextCursor!, limit: '50' })
    for (const post of mine) expect(ids(across.items)).not.toContain(post.id)
  })

  it('requires a session for the author list, whatever the query', async () => {
    const res = await myPostsList({ client: anonymous, query: { limit: '5' } })
    expect(res.response?.status).toBe(401)
    expect(res.error).toMatchObject({ _tag: 'Unauthorized' })
  })
})
