// Exercises the generated SDK against the running app and a real, freshly migrated Postgres.
// Run through `pnpm verify:app`, which starts the server and provides APP_URL and two test authors.
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  myPostsCreate,
  myPostsList,
  myPostsRemove,
  myPostsUpdate,
  publicPostsList,
  systemHealth,
  systemReady,
} from '#/sdk/sdk.gen.ts'
import { appUrl, clientIps, sdkClient, signIn, users } from './helpers.ts'

const nextIp = clientIps('192.0.2')
const anonymous = sdkClient()
let author: ReturnType<typeof sdkClient>
let other: ReturnType<typeof sdkClient>
let authorCookie: string

beforeAll(async () => {
  authorCookie = await signIn(users.author, nextIp())
  author = sdkClient(authorCookie)
  other = sdkClient(await signIn(users.other, nextIp()))
})

const create = async (client: ReturnType<typeof sdkClient>, body: string) => {
  const res = await myPostsCreate({ client, body: { body } })
  expect(res.response?.status).toBe(201)
  return res.data!
}

describe('contract', () => {
  it('serves exactly the committed openapi.json', async () => {
    const served = await (await fetch(`${appUrl}/api/openapi.json`)).json()
    expect(served).toEqual(JSON.parse(readFileSync('openapi.json', 'utf8')))
  })

  it('documents cookie auth on private operations and 400 only where there is input', () => {
    type Operation = {
      security?: Array<Record<string, string[]>>
      responses: Record<string, unknown>
      requestBody?: unknown
      parameters?: unknown[]
    }
    const spec = JSON.parse(readFileSync('openapi.json', 'utf8')) as {
      paths: Record<string, Record<string, Operation>>
      components: {
        schemas: Record<string, unknown>
        securitySchemes?: Record<string, { type: string; in?: string; name?: string }>
      }
    }
    const schemes = spec.components.securitySchemes ?? {}
    expect(
      Object.values(schemes)
        .map((s) => `${s.type} ${s.in} ${s.name}`)
        .toSorted(),
    ).toEqual(['apiKey cookie __Secure-better-auth.session_token', 'apiKey cookie better-auth.session_token'])
    // Generated names like Post_1 mean two schemas collided; the SDK types would get unstable names.
    expect(Object.keys(spec.components.schemas).filter((name) => /_\d+$/.test(name))).toEqual([])
    const operations = Object.entries(spec.paths).flatMap(([path, ops]) =>
      Object.entries(ops).map(([method, op]) => ({ id: `${method.toUpperCase()} ${path}`, path, op })),
    )
    expect(operations.length).toBeGreaterThan(0)
    for (const { id, path, op } of operations) {
      const alternatives = (op.security ?? []).flatMap((requirement) => Object.keys(requirement)).toSorted()
      expect(alternatives, id).toEqual(path.startsWith('/api/me/') ? Object.keys(schemes).toSorted() : [])
      const hasInput = op.requestBody !== undefined || (op.parameters ?? []).length > 0
      expect('400' in op.responses, id).toBe(hasInput)
    }
  })

  it('reports liveness and readiness', async () => {
    expect((await systemHealth({ client: anonymous })).data).toEqual({ status: 'ok' })
    expect((await systemReady({ client: anonymous })).data).toEqual({ status: 'ok' })
  })
})

describe('posts', () => {
  it('reads public posts anonymously', async () => {
    const { data, response } = await publicPostsList({ client: anonymous })
    expect(response?.status).toBe(200)
    expect(Array.isArray(data)).toBe(true)
  })

  it('rejects private operations without a session', async () => {
    const { error, response } = await myPostsList({ client: anonymous })
    expect(response?.status).toBe(401)
    expect(error).toMatchObject({ _tag: 'Unauthorized' })
  })

  it('performs authenticated CRUD and exposes it publicly', async () => {
    const { id } = await create(author, 'sdk integration post')

    const updated = await myPostsUpdate({ client: author, path: { id }, body: { body: 'edited' } })
    expect(updated.data).toMatchObject({ id, body: 'edited', authorName: users.author.name })

    const pub = await publicPostsList({ client: anonymous })
    expect(pub.data?.some((p) => p.id === id && p.body === 'edited')).toBe(true)

    expect((await myPostsRemove({ client: author, path: { id } })).response?.status).toBe(204)
    const again = await myPostsRemove({ client: author, path: { id } })
    expect(again.response?.status).toBe(404)
    expect(again.error).toMatchObject({ _tag: 'PostNotFound', id })
  })

  it('returns documented validation errors', async () => {
    for (const body of ['', '   ', 'x'.repeat(281)]) {
      const invalid = await myPostsCreate({ client: author, body: { body } })
      expect(invalid.response?.status).toBe(400)
      expect(invalid.error).toMatchObject({ _tag: 'ValidationError' })
    }
  })

  it('treats malformed ids as not found', async () => {
    const res = await myPostsUpdate({ client: author, path: { id: 'not-a-uuid' }, body: { body: 'x' } })
    expect(res.response?.status).toBe(404)
  })
})

describe('author isolation', () => {
  it("never lets an author list, edit or delete another author's post", async () => {
    const theirs = await create(other, `other author's post ${crypto.randomUUID()}`)

    const mine = await myPostsList({ client: author })
    expect(mine.response?.status).toBe(200)
    expect(mine.data!.map((p) => p.id)).not.toContain(theirs.id)

    const update = await myPostsUpdate({ client: author, path: { id: theirs.id }, body: { body: 'hijacked' } })
    expect(update.response?.status).toBe(404)
    expect(update.error).toMatchObject({ _tag: 'PostNotFound', id: theirs.id })
    const remove = await myPostsRemove({ client: author, path: { id: theirs.id } })
    expect(remove.response?.status).toBe(404)
    expect(remove.error).toMatchObject({ _tag: 'PostNotFound', id: theirs.id })

    // Still there, unchanged, and still theirs.
    const own = await myPostsList({ client: other })
    expect(own.data!.find((p) => p.id === theirs.id)).toEqual(theirs)
    const pub = await publicPostsList({ client: anonymous })
    expect(pub.data!.find((p) => p.id === theirs.id)).toMatchObject({ body: theirs.body, authorName: users.other.name })

    expect((await myPostsRemove({ client: other, path: { id: theirs.id } })).response?.status).toBe(204)
  })

  it("lists only the signed-in author's posts, under their own name", async () => {
    const mine = await create(author, `mine ${crypto.randomUUID()}`)
    const theirs = await create(other, `theirs ${crypto.randomUUID()}`)
    for (const [client, own, foreign, name] of [
      [author, mine, theirs, users.author.name],
      [other, theirs, mine, users.other.name],
    ] as const) {
      const list = (await myPostsList({ client })).data!
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

    const posts = JSON.parse(text) as Array<Record<string, unknown>>
    for (const post of posts)
      expect(Object.keys(post).toSorted()).toEqual(['authorName', 'body', 'createdAt', 'id', 'updatedAt'])
    expect(posts.find((p) => p.id === mine.id)?.authorName).toBe(users.author.name)
    expect(posts.find((p) => p.id === theirs.id)?.authorName).toBe(users.other.name)
    await myPostsRemove({ client: author, path: { id: mine.id } })
    await myPostsRemove({ client: other, path: { id: theirs.id } })
  })
})

describe('security', () => {
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
    const own = (await myPostsList({ client: author })).data!
    expect(own.find((p) => p.id === post.id)?.body).toBe(post.body)
    expect(own.filter((p) => p.body === 'csrf')).toEqual([])
    await myPostsRemove({ client: author, path: { id: post.id } })
  })

  it('keeps public sign-up closed', async () => {
    const res = await fetch(`${appUrl}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: appUrl, 'x-forwarded-for': nextIp() },
      body: JSON.stringify({ email: 'new@example.test', password: 'a-long-enough-password', name: 'New' }),
    })
    expect(res.status).toBe(404)
  })

  it('sends security headers and keeps private pages out of shared caches', async () => {
    const home = await fetch(appUrl)
    expect(home.headers.get('x-content-type-options')).toBe('nosniff')
    expect(home.headers.get('x-frame-options')).toBe('DENY')
    // Public but rendered per request: revalidate every time, never stored by shared caches.
    expect(home.headers.get('cache-control')).toBe('private, no-cache')
    const dashboard = await fetch(`${appUrl}/dashboard`, { headers: { cookie: authorCookie } })
    expect(dashboard.status).toBe(200)
    expect(dashboard.headers.get('cache-control')).toContain('no-store')
  })
})
