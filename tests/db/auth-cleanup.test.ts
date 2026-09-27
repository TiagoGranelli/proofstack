// deleteExpiredAuthRows (src/server/auth-cleanup.ts) against real Postgres: which sessions and verification
// tokens the periodic cleanup deletes, which it keeps, and that it costs two statements.
import { eq, inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { deleteExpiredAuthRows, EXPIRED_SESSION_RETENTION_MS } from '#/server/auth-cleanup.ts'
import { db, pool } from '#/server/db/client.ts'
import { session, verification } from '#/server/db/schema/index.ts'
import { createAccount, expectBudget, statementsOf } from './helpers.ts'

const HOUR = 60 * 60 * 1000

afterAll(() => pool.end())

/** A session of `userId` that expires at `expiresAt` (epoch ms), its id prefixed with `label`. */
const sessionRow = (userId: string, label: string, expiresAt: number) => ({
  id: `${label}-${crypto.randomUUID()}`,
  token: crypto.randomUUID(),
  userId,
  expiresAt: new Date(expiresAt),
  updatedAt: new Date(),
  ipAddress: '192.0.2.1',
})

/** A password-reset token for `userId` that expires at `expiresAt` (epoch ms), its id prefixed with `label`. */
const tokenRow = (userId: string, label: string, expiresAt: number) => ({
  id: `${label}-${crypto.randomUUID()}`,
  identifier: `reset-password:${crypto.randomUUID()}`,
  value: userId,
  expiresAt: new Date(expiresAt),
})

describe('deleteExpiredAuthRows', () => {
  it('deletes sessions expired longer than the retention and expired verification tokens, nothing else', async () => {
    const now = Date.now()
    const { id: userId } = await createAccount('cleanup')
    const sessions = {
      old: sessionRow(userId, 'old', now - EXPIRED_SESSION_RETENTION_MS - HOUR),
      recent: sessionRow(userId, 'recent', now - HOUR),
      active: sessionRow(userId, 'active', now + HOUR),
    }
    await db.insert(session).values(Object.values(sessions))
    const tokens = { expired: tokenRow(userId, 'expired', now - 1000), valid: tokenRow(userId, 'valid', now + HOUR) }
    await db.insert(verification).values(Object.values(tokens))

    const { returned: deleted, statements } = await statementsOf(() => deleteExpiredAuthRows(now))
    expectBudget('deleteExpiredAuthRows', statements, 2)
    // Other files' rows may expire too, so at least ours.
    expect(deleted.sessions).toBeGreaterThanOrEqual(1)
    expect(deleted.verifications).toBeGreaterThanOrEqual(1)

    const left = await db
      .select({ id: session.id })
      .from(session)
      .where(eq(session.userId, userId))
      .then((rows) => rows.map((row) => row.id).toSorted())
    expect(left).toEqual([sessions.active.id, sessions.recent.id].toSorted())
    const tokensLeft = await db
      .select({ id: verification.id })
      .from(verification)
      .where(inArray(verification.id, [tokens.expired.id, tokens.valid.id]))
    expect(tokensLeft).toEqual([{ id: tokens.valid.id }])
  })
})
