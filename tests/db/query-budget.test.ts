// Query budgets against real Postgres: each repository method, and each server path that reads a list of
// rows, issues a fixed number of SQL statements whatever the data size. An N+1 (a query per row) fails here
// with the method's name and the statements it sent. A new repository method gets a budget here.
import { drizzle } from 'drizzle-orm/node-postgres'
import { Effect, Layer } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PageCursor, PostPage } from '#/contract/posts.ts'
import { auth } from '#/server/auth.ts'
import { Database, pool } from '#/server/db/client.ts'
import * as schema from '#/server/db/schema/index.ts'
import { env } from '#/server/env.ts'
import { PostsRepo } from '#/server/posts/repo.ts'
import { createAccount, expectBudget, statementsOf } from './helpers.ts'

afterAll(() => pool.end())

/** The app's pool behind a Drizzle client that records every statement it sends, injected as `Database`. */
const logged: string[] = []
const recordingDb = drizzle({ client: pool, schema, logger: { logQuery: (query) => void logged.push(query) } })
const repoLayer = PostsRepo.layer.pipe(Layer.provide(Layer.succeed(Database, recordingDb)))

type Repo = typeof PostsRepo.Service
/** Runs one repository call and checks it sent exactly `budget` statements. */
const withBudget = async <A, E>(what: string, budget: number, call: (repo: Repo) => Effect.Effect<A, E>) => {
  logged.length = 0
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* call(yield* PostsRepo)
    }).pipe(Effect.provide(repoLayer)),
  )
  expectBudget(what, [...logged], budget)
  return result
}

type Author = { id: string; name: string }
let few: Author
let many: Author
beforeAll(async () => {
  const [a, b] = await Promise.all([createAccount('budget-few'), createAccount('budget-many')])
  few = a
  many = b
  await recordingDb.insert(schema.post).values({ authorId: few.id, body: 'the only post' })
  await recordingDb
    .insert(schema.post)
    .values(Array.from({ length: 50 }, (_, i) => ({ authorId: many.id, body: `post ${i}` })))
})

const lastKey = (page: PostPage): PageCursor | undefined => page.nextCursor ?? undefined

describe('PostsRepo', () => {
  it('lists one page in one statement, with 1 post or 50, with or without a cursor', async () => {
    const one = await withBudget('listByAuthor (1 post)', 1, (repo) => repo.listByAuthor(few, { limit: 20 }))
    expect(one.items).toHaveLength(1)
    const full = await withBudget('listByAuthor (50 posts)', 1, (repo) => repo.listByAuthor(many, { limit: 50 }))
    expect(full.items).toHaveLength(50)
    const first = await withBudget('listByAuthor (page 1 of 50)', 1, (repo) => repo.listByAuthor(many, { limit: 20 }))
    const next = await withBudget('listByAuthor (page 2 of 50)', 1, (repo) =>
      repo.listByAuthor(many, { limit: 20, cursor: lastKey(first) }),
    )
    expect(next.items).toHaveLength(20)

    // The public list joins the author's name in the same statement, however many authors a page holds.
    const small = await withBudget('listPublic (limit 1)', 1, (repo) => repo.listPublic({ limit: 1 }))
    const large = await withBudget('listPublic (limit 50)', 1, (repo) =>
      repo.listPublic({ limit: 50, cursor: lastKey(small) }),
    )
    expect(new Set(large.items.map((post) => post.authorName)).size).toBeGreaterThan(1)
  })

  it('creates, edits and deletes in one statement each, and edits move updatedAt', async () => {
    const created = await withBudget('create', 1, (repo) => repo.create(few, 'budgeted'))
    const updated = await withBudget('update', 1, (repo) => repo.update(few, created.id, 'budgeted, edited'))
    expect(updated?.createdAt).toBe(created.createdAt)
    expect(Date.parse(updated!.updatedAt)).toBeGreaterThan(Date.parse(created.updatedAt))
    // Another author's post: the same single statement finds nothing.
    expect(await withBudget('update (not the owner)', 1, (repo) => repo.update(many, created.id, 'x'))).toBeUndefined()
    // A malformed id never reaches Postgres.
    expect(await withBudget('update (malformed id)', 0, (repo) => repo.update(few, 'not-a-uuid', 'x'))).toBeUndefined()
    expect(await withBudget('remove (malformed id)', 0, (repo) => repo.remove(few, 'not-a-uuid'))).toBe(false)
    expect(await withBudget('remove', 1, (repo) => repo.remove(few, created.id))).toBe(true)
    expect(await withBudget('remove (gone)', 1, (repo) => repo.remove(few, created.id))).toBe(false)
    await withBudget('ping', 1, (repo) => repo.ping)
  })
})

/** A request to Better Auth's router as a signed-in browser of this app would send it. */
const request = (path: string, cookie: string, method: 'GET' | 'POST', body: Record<string, unknown> = {}) =>
  auth.handler(
    new Request(`${env.appUrl}/api/auth${path}`, {
      method,
      headers: {
        cookie,
        origin: env.appUrl,
        ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
      },
      ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
    }),
  )

/** An account signed in once (the cookie's session), plus `others` more sessions. */
const signedIn = async (others: number) => {
  const account = await createAccount(`sessions-${others}`)
  const response = await auth.handler(
    new Request(`${env.appUrl}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: env.appUrl },
      body: JSON.stringify({ email: account.email, password: account.password }),
    }),
  )
  expect(response.status).toBe(200)
  const cookie = response.headers
    .getSetCookie()
    .map((c) => c.split(';')[0]!)
    .join('; ')
  const context = await auth.$context
  for (let i = 0; i < others; i++) await context.internalAdapter.createSession(account.id)
  return { cookie, password: account.password }
}

/**
 * Better Auth's session endpoints behind the account page (listSessions, revokeSession and the sign-out
 * actions in src/lib/auth.functions.ts, which map the listed rows in memory), called through its router like
 * callAuthEndpoint does. Counted at pg's Client, which Better Auth's Drizzle adapter uses.
 */
describe('session endpoints', () => {
  /**
   * Statements each endpoint may send for an account with the cookie's session plus `others` more. Better Auth
   * 1.7.6 revokes other sessions one by one (a lookup and a delete per session, `Promise.all` over
   * `internalAdapter.deleteSession` in its /revoke-other-sessions): a known upstream N+1, budgeted as it is so
   * that it cannot grow unnoticed and a fix upstream shows up here. The others are constant.
   */
  const BUDGETS = {
    'GET /list-sessions': () => 3,
    'POST /revoke-sessions': () => 4,
    'POST /revoke-other-sessions': (others: number) => 3 + 2 * others,
    // changePassword in src/lib/auth.functions.ts always signs the other sessions out with it.
    'POST /change-password': () => 7,
  }
  const bodies: Partial<Record<keyof typeof BUDGETS, (password: string) => Record<string, unknown>>> = {
    'POST /change-password': (password) => ({
      currentPassword: password,
      newPassword: `new-${password}`,
      revokeOtherSessions: true,
    }),
  }

  it('lists the cookie session and the others, so the budgets below count 1 session and 21', async () => {
    for (const others of [0, 20]) {
      const { cookie } = await signedIn(others)
      expect(await (await request('/list-sessions', cookie, 'GET')).json()).toHaveLength(others + 1)
    }
  })

  it.each(Object.keys(BUDGETS) as Array<keyof typeof BUDGETS>)(
    'answers %s within its budget for 1 session and for 21',
    async (what) => {
      const [method, path] = what.split(' ') as ['GET' | 'POST', string]
      for (const others of [0, 20]) {
        const { cookie, password } = await signedIn(others)
        const body = bodies[what]?.(password)
        const { result, statements } = await statementsOf(() => request(path, cookie, method, body))
        expect(result.status, `${what} with ${others + 1} sessions`).toBe(200)
        expectBudget(`${what} with ${others + 1} sessions`, statements, BUDGETS[what](others))
      }
    },
  )
})
