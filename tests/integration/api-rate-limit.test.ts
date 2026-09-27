// The business API's write limit (WriteRateLimit, src/server/api/rate-limit.ts): per user, on the rate_limit
// table Better Auth's limits use, incremented atomically. A throwaway account, so no other file's writes
// share its bucket; deletes of a post that does not exist count without changing any data.
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { POST_WRITE_WINDOW_SECONDS, POST_WRITES_PER_WINDOW } from '#/contract/limits.ts'
import { appUrl, clientIps, createUser, signIn } from './helpers.ts'

const nextIp = clientIps('100.64.6')
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
afterAll(() => pool.end())

let cookie: string
let userId: string
beforeAll(async () => {
  cookie = await signIn(await createUser('writes'), nextIp())
  const session = await fetch(`${appUrl}/api/auth/get-session`, { headers: { cookie } })
  userId = ((await session.json()) as { user: { id: string } }).user.id
})

const deleteMissing = () =>
  fetch(`${appUrl}/api/me/posts/${crypto.randomUUID()}`, { method: 'DELETE', headers: { cookie, origin: appUrl } })

describe('write rate limit', () => {
  it('admits exactly the limit when writes race, then answers 429 with the wait', async () => {
    const responses = await Promise.all(Array.from({ length: POST_WRITES_PER_WINDOW + 10 }, deleteMissing))
    const statuses = responses.map((res) => res.status).toSorted((a, b) => a - b)
    expect(statuses).toEqual([
      ...Array.from({ length: POST_WRITES_PER_WINDOW }, () => 404),
      ...Array.from({ length: 10 }, () => 429),
    ])

    const refused = await deleteMissing()
    expect(refused.status).toBe(429)
    const body = (await refused.json()) as { _tag: string; retryAfter: number }
    expect(body).toMatchObject({ _tag: 'RateLimited', message: 'Too many changes to your posts' })
    expect(body.retryAfter).toBeGreaterThan(0)
    expect(body.retryAfter).toBeLessThanOrEqual(POST_WRITE_WINDOW_SECONDS)

    // One row per user, next to Better Auth's `<ip>|<path>` rows; reads are not counted.
    expect((await fetch(`${appUrl}/api/me/posts`, { headers: { cookie } })).status).toBe(200)
    const { rows } = await pool.query<{ key: string; count: number }>(
      'select key, count from rate_limit where key like $1',
      [`api-write|${userId}`],
    )
    expect(rows).toEqual([{ key: `api-write|${userId}`, count: POST_WRITES_PER_WINDOW + 11 }])
  })
})
