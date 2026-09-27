// postgresRateLimitStorage (src/server/auth-rate-limit.ts) against real Postgres: the rule every limit uses
// (Better Auth's sign-in limit and the business API's write limit), its atomicity under concurrent requests,
// the wait it reports, pruning and its query budget. Each test has its own key; time moves by editing the row
// or with a fake Date, never by sleeping.
import { eq, inArray } from 'drizzle-orm'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { postgresRateLimitStorage as storage } from '#/server/auth-rate-limit.ts'
import { db, pool } from '#/server/db/client.ts'
import { rateLimit } from '#/server/db/schema/index.ts'
import { expectBudget, statementsOf } from './helpers.ts'

const RULE = { window: 60, max: 3 }
const newKey = () => `test|${crypto.randomUUID()}`
const row = async (key: string) => (await db.select().from(rateLimit).where(eq(rateLimit.key, key)))[0]
/** Moves the window of `key` into the past, as if its last admitted request happened `ms` earlier. */
const age = (key: string, ms: number) =>
  pool.query('update rate_limit set last_request = last_request - $1 where key = $2', [ms, key])

afterEach(() => {
  vi.useRealTimers()
})
afterAll(() => pool.end())

describe('postgresRateLimitStorage', () => {
  it('counts in an UNLOGGED table keyed by `key` (a crash resets the windows; docs/operations.md)', async () => {
    const { rows } = await pool.query<{ persistence: string; key: string }>(
      `select c.relpersistence as persistence, pg_get_constraintdef(k.oid) as key
         from pg_class c join pg_constraint k on k.conrelid = c.oid and k.contype = 'p'
        where c.oid = 'rate_limit'::regclass`,
    )
    expect(rows).toEqual([{ persistence: 'u', key: 'PRIMARY KEY (key)' }])
  })

  it('starts a window at the first request of a key', async () => {
    const key = newKey()
    const before = Date.now()
    expect(await storage.consume(key, RULE)).toEqual({ allowed: true, retryAfter: null })
    const stored = await row(key)
    expect(stored?.count).toBe(1)
    expect(stored?.lastRequest).toBeGreaterThanOrEqual(before)
    expect(stored?.lastRequest).toBeLessThanOrEqual(Date.now())
  })

  it('admits exactly max requests, then refuses with the rest of the window', async () => {
    const key = newKey()
    for (let i = 0; i < RULE.max; i++) expect((await storage.consume(key, RULE)).allowed).toBe(true)
    const lastAdmitted = (await row(key))!.lastRequest
    expect(await storage.consume(key, RULE)).toEqual({ allowed: false, retryAfter: RULE.window })
    // A refused request is counted but does not move the window.
    expect(await row(key)).toMatchObject({ count: RULE.max + 1, lastRequest: lastAdmitted })
  })

  it('reports the time left since the last admitted request, rounded up, at least one second', async () => {
    const key = newKey()
    for (let i = 0; i <= RULE.max; i++) await storage.consume(key, RULE)
    await age(key, 30_000)
    expect(await storage.consume(key, RULE)).toEqual({ allowed: false, retryAfter: 30 })
    await age(key, 29_500)
    expect(await storage.consume(key, RULE)).toEqual({ allowed: false, retryAfter: 1 })
  })

  it('restarts the window once it has passed since the last admitted request', async () => {
    const key = newKey()
    for (let i = 0; i <= RULE.max; i++) await storage.consume(key, RULE)
    await age(key, RULE.window * 1000)
    expect(await storage.consume(key, RULE)).toEqual({ allowed: true, retryAfter: null })
    expect((await row(key))?.count).toBe(1)
  })

  it('keeps separate counts per key', async () => {
    const [first, second] = [newKey(), newKey()]
    for (let i = 0; i <= RULE.max; i++) await storage.consume(first, RULE)
    expect((await storage.consume(second, RULE)).allowed).toBe(true)
  })

  it('admits exactly max of many concurrent requests', async () => {
    const key = newKey()
    const rule = { window: 60, max: 5 }
    const decisions = await Promise.all(Array.from({ length: 40 }, () => storage.consume(key, rule)))
    expect(decisions.filter((decision) => decision.allowed)).toHaveLength(rule.max)
    expect((await row(key))?.count).toBe(40)
  })

  it('prunes rows idle for ten minutes, at most once per ten minutes, and costs one statement otherwise', async () => {
    // A process prunes on its first request and then every ten minutes; jump past that with a fake clock.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 60 * 60 * 1000)
    const now = Date.now()
    const [idle, recent, key] = [newKey(), newKey(), newKey()]
    await db.insert(rateLimit).values([
      { key: idle, count: 1, lastRequest: now - 11 * 60 * 1000 },
      { key: recent, count: 1, lastRequest: now - 9 * 60 * 1000 },
    ])

    const first = await statementsOf(async () => {
      await storage.consume(key, RULE)
      // The prune runs in the background; wait until it has deleted the idle row.
      await expect.poll(async () => (await row(idle)) ?? null).toBeNull()
    })
    const remaining = await db
      .select({ key: rateLimit.key })
      .from(rateLimit)
      .where(inArray(rateLimit.key, [idle, recent]))
    expect(remaining).toEqual([{ key: recent }])
    // The upsert and the prune; the polling reads above are the test's own.
    expectBudget(
      'consume (pruning)',
      first.statements.filter((sql) => !sql.startsWith('select')),
      2,
    )

    // Within the next ten minutes: one statement per request, whatever the count.
    vi.setSystemTime(now + 9 * 60 * 1000)
    const later = await statementsOf(async () => {
      for (let i = 0; i < 5; i++) await storage.consume(key, RULE)
    })
    expectBudget('5 × consume', later.statements, 5)
  })
})
