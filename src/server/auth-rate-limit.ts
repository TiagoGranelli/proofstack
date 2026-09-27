import '@tanstack/react-start/server-only'
import type { BetterAuthOptions } from 'better-auth'
import { lt, sql } from 'drizzle-orm'
import { runInBackground } from './background-tasks.ts'
import { db } from './db/client.ts'
import { rateLimit } from './db/schema/rate-limit.ts'

type RateLimitStorage = NonNullable<NonNullable<BetterAuthOptions['rateLimit']>['customStorage']>

/** Rows idle this long are deleted; longer than every rule's window (the longest is 60 s). */
const IDLE_ROW_MS = 10 * 60 * 1000
let lastPrune = 0

/** Deletes idle rows in the background, at most once per IDLE_ROW_MS per process. */
const pruneIdleRows = (now: number): void => {
  if (now - lastPrune <= IDLE_ROW_MS) return
  lastPrune = now
  runInBackground(db.delete(rateLimit).where(lt(rateLimit.lastRequest, now - IDLE_ROW_MS)))
}

/**
 * Better Auth's rate-limit `consume` on the rate_limit table (also the business API's write limit, keys
 * `api-write|<user id>`, ./api/rate-limit.ts) as one INSERT ... ON CONFLICT DO UPDATE, which
 * Postgres runs atomically per key: concurrent requests never both take the last slot. Same rule as Better
 * Auth's own storages: a window starts at the first request and restarts once `window` seconds passed since the
 * last admitted one. `count` counts every request in the window, so it passes `max` exactly when one is refused.
 *
 * Better Auth's `storage: 'database'` is not atomic on Postgres with the Drizzle adapter (1.7.6): its
 * `incrementOne` updates `WHERE id IN (SELECT id ... WHERE count < max)`, and Postgres does not re-evaluate that
 * subquery after waiting for the row lock, so 20 concurrent sign-ins passed a limit of 3 about 10 times in a
 * reproduction. Replacing this with `storage: 'database'` once the adapter conditions the UPDATE itself also means
 * giving the table back Better Auth's `id` column.
 */
export const postgresRateLimitStorage: RateLimitStorage = {
  async consume(key, rule) {
    const now = Date.now()
    const windowMs = rule.window * 1000
    const expired = sql`${rateLimit.lastRequest} <= ${now - windowMs}`
    const [row] = await db
      .insert(rateLimit)
      .values({ key, count: 1, lastRequest: now })
      .onConflictDoUpdate({
        target: rateLimit.key,
        set: {
          count: sql`case when ${expired} then 1 else ${rateLimit.count} + 1 end`,
          lastRequest: sql`case when ${expired} or ${rateLimit.count} < ${rule.max} then ${now} else ${rateLimit.lastRequest} end`,
        },
      })
      .returning({ count: rateLimit.count, lastRequest: rateLimit.lastRequest })
    pruneIdleRows(now)
    // `count` is the number of requests since the window started, refused ones included.
    if (row && row.count <= rule.max) return { allowed: true, retryAfter: null }
    const lastRequest = row?.lastRequest ?? now
    return { allowed: false, retryAfter: Math.max(1, Math.ceil((lastRequest + windowMs - now) / 1000)) }
  },
}
