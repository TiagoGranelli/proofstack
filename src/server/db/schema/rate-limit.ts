import { bigint, integer, pgTable, text } from 'drizzle-orm/pg-core'

// Not Better Auth's table: the rate-limit counters of ../../auth-rate-limit.ts (Better Auth's `customStorage` and
// the API's write limit), one row per key. `lastRequest` is epoch milliseconds. UNLOGGED (drizzle/0005, Drizzle
// cannot declare it): writes skip the WAL, and a crash empties the table, which only restarts every window.
export const rateLimit = pgTable('rate_limit', {
  key: text('key').primaryKey(),
  count: integer('count').notNull(),
  lastRequest: bigint('last_request', { mode: 'number' }).notNull(),
})
