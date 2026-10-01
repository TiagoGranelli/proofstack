// The example's posts through the generated SDK against the running app and a real, freshly migrated Postgres:
// CRUD, validation, author isolation, and CSRF on each write, against the running app (`pnpm test`).
import { beforeAll, describe, expect, it } from 'vitest'
import { createClient } from '#/sdk/client/index.ts'
import { myPostsCreate, myPostsList, myPostsRemove, myPostsUpdate, publicPostsList } from '#/sdk/sdk.gen.ts'
import { appUrl, clientIps, createUser, sdkClient, signIn } from './helpers.ts'

const nextIp = clientIps('100.64.7')
const anonymous = sdkClient()
let author: ReturnType<typeof sdkClient>
let other: ReturnType<typeof sdkClient>
let authorCookie: string
// This file's own accounts: other files run in parallel, and their posts would show up in what these two own.
let users: { author: Awaited<ReturnType<typeof createUser>>; other: Awaited<ReturnType<typeof createUser>> }

beforeAll(async () => {
  const [authorAccount, otherAccount] = await Promise.all([createUser('posts-author'), createUser('posts-other')])
  users = { author: authorAccount, other: otherAccount }
  authorCookie = await signIn(users.author, nextIp())
  author = sdkClient(authorCookie)
  other = sdkClient(await signIn(users.other, nextIp()))
})

const create = async (client: ReturnType<typeof sdkClient>, body: string) => {
  const res = await myPostsCreate({ client, body: { body } })
  expect(res.response?.status).toBe(201)
  return res.data!
}

describe('posts', () => {
  it('reads public posts anonymously', async () => {
    const { data, response } = await publicPostsList({ client: anonymous })
    expect(response?.status).toBe(200)
    expect(Array.isArray(data?.items)).toBe(true)
  })

  it('rejects private operations without a session', async () => {
    const { error, response } = await myPostsList({ client: anonymous })
    expect(response?.status).toBe(401)
    expect(error).toMatchObject({ _tag: 'Unauthorized' })
  })

  // With our Origin, so the CSRF check passes and authentication is what refuses them (not a 403).
  it('rejects every write without a session, or with a forged one, as Unauthorized', async () => {
    const post = await create(author, `401 target ${crypto.randomUUID()}`)
    for (const cookie of [undefined, 'better-auth.session_token=forged.token']) {
      const client = createClient({ baseUrl: appUrl, headers: { origin: appUrl, ...(cookie ? { cookie } : {}) } })
      for (const [name, call] of [
        ['create', () => myPostsCreate({ client, body: { body: 'no session' } })],
        ['update', () => myPostsUpdate({ client, path: { id: post.id }, body: { body: 'no session' } })],
        ['remove', () => myPostsRemove({ client, path: { id: post.id } })],
      ] as const) {
        const { error, response } = await call()
        expect(response?.status, `${name} with ${cookie ?? 'no cookie'}`).toBe(401)
        expect(error).toEqual({ _tag: 'Unauthorized', message: 'Authentication required' })
      }
    }
    const own = (await myPostsList({ client: author })).data!.items
    expect(own.find((p) => p.id === post.id)).toEqual(post)
    await myPostsRemove({ client: author, path: { id: post.id } })
  })

  it('performs authenticated CRUD and exposes it publicly', async () => {
    const created = await create(author, 'sdk integration post')
    const { id } = created
    expect(created.updatedAt).toBe(created.createdAt)

    const updated = await myPostsUpdate({ client: author, path: { id }, body: { body: 'edited' } })
    expect(updated.data).toMatchObject({ id, body: 'edited', authorName: users.author.name })
    // An edit moves updatedAt (the column the UI marks "edited" from) and leaves createdAt, the sort key, alone.
    expect(updated.data!.createdAt).toBe(created.createdAt)
    expect(Date.parse(updated.data!.updatedAt)).toBeGreaterThan(Date.parse(created.updatedAt))
    const listed = (await myPostsList({ client: author })).data!.items.find((p) => p.id === id)
    expect(listed).toEqual(updated.data)

    const pub = await publicPostsList({ client: anonymous })
    expect(pub.data?.items.some((p) => p.id === id && p.body === 'edited')).toBe(true)

    expect((await myPostsRemove({ client: author, path: { id } })).response?.status).toBe(204)
    const again = await myPostsRemove({ client: author, path: { id } })
    expect(again.response?.status).toBe(404)
    expect(again.error).toMatchObject({ _tag: 'PostNotFound', id })
  })

  it('returns documented validation errors', async () => {
    // A NUL reaches Postgres as a 500 unless the contract refuses it (src/contract/stored-text.ts).
    for (const body of ['', '   ', 'x'.repeat(281), 'before\u0000after']) {
      const invalid = await myPostsCreate({ client: author, body: { body } })
      expect(invalid.response?.status, JSON.stringify(body)).toBe(400)
      expect(invalid.error).toMatchObject({ _tag: 'ValidationError', issues: [{ path: ['body'] }] })
    }
  })

  it('treats malformed ids as not found, on edit and delete alike', async () => {
    for (const id of ['not-a-uuid', '00000000-0000-4000-8000-00000000000', "1' or '1'='1", '%00']) {
      const update = await myPostsUpdate({ client: author, path: { id }, body: { body: 'x' } })
      expect(update.response?.status, `PATCH ${id}`).toBe(404)
      expect(update.error).toEqual({ _tag: 'PostNotFound', id })
      const remove = await myPostsRemove({ client: author, path: { id } })
      expect(remove.response?.status, `DELETE ${id}`).toBe(404)
      expect(remove.error).toEqual({ _tag: 'PostNotFound', id })
    }
  })
})

describe('author isolation', () => {
  it("never lets an author list, edit or delete another author's post", async () => {
    const theirs = await create(other, `other author's post ${crypto.randomUUID()}`)

    const mine = await myPostsList({ client: author })
    expect(mine.response?.status).toBe(200)
    expect(mine.data!.items.map((p) => p.id)).not.toContain(theirs.id)

    const update = await myPostsUpdate({ client: author, path: { id: theirs.id }, body: { body: 'hijacked' } })
    expect(update.response?.status).toBe(404)
    expect(update.error).toMatchObject({ _tag: 'PostNotFound', id: theirs.id })
    const remove = await myPostsRemove({ client: author, path: { id: theirs.id } })
    expect(remove.response?.status).toBe(404)
    expect(remove.error).toMatchObject({ _tag: 'PostNotFound', id: theirs.id })

    // Still there, unchanged, and still theirs.
    const own = await myPostsList({ client: other })
    expect(own.data!.items.find((p) => p.id === theirs.id)).toEqual(theirs)
    const pub = await publicPostsList({ client: anonymous })
    expect(pub.data!.items.find((p) => p.id === theirs.id)).toMatchObject({
      body: theirs.body,
      authorName: users.other.name,
    })

    expect((await myPostsRemove({ client: other, path: { id: theirs.id } })).response?.status).toBe(204)
  })

  it("lists only the signed-in author's posts, under their own name", async () => {
    const mine = await create(author, `mine ${crypto.randomUUID()}`)
    const theirs = await create(other, `theirs ${crypto.randomUUID()}`)
    for (const [client, own, foreign, name] of [
      [author, mine, theirs, users.author.name],
      [other, theirs, mine, users.other.name],
    ] as const) {
      const list = (await myPostsList({ client })).data!.items
      expect(list.map((p) => p.id)).toContain(own.id)
      expect(list.map((p) => p.id)).not.toContain(foreign.id)
      expect(new Set(list.map((p) => p.authorName))).toEqual(new Set([name]))
    }
    await myPostsRemove({ client: author, path: { id: mine.id } })
    await myPostsRemove({ client: other, path: { id: theirs.id } })
  })

  it('shows author names publicly and never emails or internal ids', async () => {
    const mine = await create(author, `public by author ${crypto.randomUUID()}`)
    const theirs = await create(other, `public by other ${crypto.randomUUID()}`)
    const res = await fetch(`${appUrl}/api/posts`)
    const text = await res.text()
    for (const user of Object.values(users)) expect(text).not.toContain(user.email)
    expect(text).not.toMatch(/authorId|author_id|email/i)

    const { items: posts } = JSON.parse(text) as { items: Array<Record<string, unknown>> }
    for (const post of posts)
      expect(Object.keys(post).toSorted()).toEqual(['authorName', 'body', 'createdAt', 'id', 'updatedAt'])
    expect(posts.find((p) => p.id === mine.id)?.authorName).toBe(users.author.name)
    expect(posts.find((p) => p.id === theirs.id)?.authorName).toBe(users.other.name)
    await myPostsRemove({ client: author, path: { id: mine.id } })
    await myPostsRemove({ client: other, path: { id: theirs.id } })
  })
})

describe('csrf on post writes', () => {
  const attempts: Array<[string, Record<string, string>]> = [
    ['cross-site fetch metadata', { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }],
    // Older browsers and non-browser clients send no Sec-Fetch-Site: Origin alone must decide.
    ['a foreign Origin without fetch metadata', { origin: 'https://evil.example' }],
    ['no Origin, Referer or fetch metadata', {}],
  ]

  it.each(attempts)('rejects /api mutations with %s', async (_, headers) => {
    const post = await create(author, `csrf target ${crypto.randomUUID()}`)
    const requests: Array<[string, string, string?]> = [
      ['POST', '/api/me/posts', JSON.stringify({ body: 'csrf' })],
      ['PATCH', `/api/me/posts/${post.id}`, JSON.stringify({ body: 'csrf' })],
      ['DELETE', `/api/me/posts/${post.id}`],
    ]
    for (const [method, path, body] of requests) {
      const res = await fetch(appUrl + path, {
        method,
        headers: { cookie: authorCookie, 'content-type': 'application/json', ...headers },
        ...(body ? { body } : {}),
      })
      expect(res.status, `${method} ${path}`).toBe(403)
    }
    const own = (await myPostsList({ client: author })).data!.items
    expect(own.find((p) => p.id === post.id)?.body).toBe(post.body)
    expect(own.filter((p) => p.body === 'csrf')).toEqual([])
    await myPostsRemove({ client: author, path: { id: post.id } })
  })

  it('answers a malformed body with a 400 that leaks nothing', async () => {
    const res = await fetch(`${appUrl}/api/me/posts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: appUrl, cookie: authorCookie },
      body: '{',
    })
    expect(res.status).toBe(400)
    expect(await res.text()).not.toMatch(/\bat .+:\d+:\d+|node_modules|\.mjs|select |postgres/i)
  })
})
