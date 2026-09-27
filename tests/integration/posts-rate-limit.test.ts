// The business API's write limit (WriteRateLimit, src/server/api/rate-limit.ts): per user, on the rate_limit
// table Better Auth's limits use, incremented atomically. A throwaway account, so no other file's writes
// share its bucket; deletes of a post that does not exist count without changing any data.
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { WRITE_WINDOW_SECONDS, WRITES_PER_WINDOW } from '#/contract/limits.ts'
import { appUrl, databaseUrl, clientIps, createUser, signIn } from './helpers.ts'

const nextIp = clientIps('100.64.6')
const pool = new Pool({ connectionString: databaseUrl })
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
    const responses = await Promise.all(Array.from({ length: WRITES_PER_WINDOW + 10 }, deleteMissing))
    const statuses = responses.map((res) => res.status).toSorted((a, b) => a - b)
    expect(statuses).toEqual([
      ...Array.from({ length: WRITES_PER_WINDOW }, () => 404),
      ...Array.from({ length: 10 }, () => 429),
    ])

    // The wait is what the store computed from the window's last admitted write, not a stand-in for the whole
    // window: move that write 30 s into the past, and a refused write must be told about the 30 s left.
    const key = `api-write|${userId}`
    await pool.query('update rate_limit set last_request = last_request - 30000 where key = $1', [key])
    const {
      rows: [{ last_request: lastRequest } = { last_request: '0' }],
    } = await pool.query<{ last_request: string }>('select last_request from rate_limit where key = $1', [key])
    const before = Date.now()
    const refused = await deleteMissing()
    const after = Date.now()
    expect(refused.status).toBe(429)
    const body = (await refused.json()) as { _tag: string; retryAfter: number }
    expect(body).toMatchObject({ _tag: 'RateLimited', message: 'Too many changes in a short time' })
    const windowEnd = Number(lastRequest) + WRITE_WINDOW_SECONDS * 1000
    expect(body.retryAfter).toBeGreaterThanOrEqual(Math.ceil((windowEnd - after) / 1000))
    expect(body.retryAfter).toBeLessThanOrEqual(Math.ceil((windowEnd - before) / 1000))
    expect(body.retryAfter).toBeLessThan(WRITE_WINDOW_SECONDS - 20)

    // Creating and editing share the bucket: refused the same way, before the body is read, and counted.
    for (const [method, path] of [
      ['POST', '/api/me/posts'],
      ['PATCH', `/api/me/posts/${crypto.randomUUID()}`],
    ] as const) {
      const res = await fetch(`${appUrl}${path}`, {
        method,
        headers: { cookie, origin: appUrl, 'content-type': 'application/json' },
        body: JSON.stringify({ body: 'over the limit' }),
      })
      expect(res.status, method).toBe(429)
      expect(await res.json()).toMatchObject({ _tag: 'RateLimited', message: 'Too many changes in a short time' })
    }

    // One row per user, next to Better Auth's `<ip>|<path>` rows; reads are not counted.
    expect((await fetch(`${appUrl}/api/me/posts`, { headers: { cookie } })).status).toBe(200)
    const { rows } = await pool.query<{ key: string; count: number }>(
      'select key, count from rate_limit where key like $1',
      [`api-write|${userId}`],
    )
    expect(rows).toEqual([{ key, count: WRITES_PER_WINDOW + 13 }])
  })
})
