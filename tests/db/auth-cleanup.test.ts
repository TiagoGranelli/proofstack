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

describe('deleteExpiredAuthRows', () => {
  it('deletes sessions expired longer than the retention and expired verification tokens, nothing else', async () => {
    const now = Date.now()
    const { id: userId } = await createAccount('cleanup')
    const sessionAt = (label: string, expiresAt: number) => ({
      id: `${label}-${crypto.randomUUID()}`,
      token: crypto.randomUUID(),
      userId,
      expiresAt: new Date(expiresAt),
      updatedAt: new Date(now),
      ipAddress: '192.0.2.1',
    })
    const sessions = {
      old: sessionAt('old', now - EXPIRED_SESSION_RETENTION_MS - HOUR),
      recent: sessionAt('recent', now - HOUR),
      active: sessionAt('active', now + HOUR),
    }
    await db.insert(session).values(Object.values(sessions))
    const tokenAt = (label: string, expiresAt: number) => ({
      id: `${label}-${crypto.randomUUID()}`,
      identifier: `reset-password:${crypto.randomUUID()}`,
      value: userId,
      expiresAt: new Date(expiresAt),
    })
    const tokens = { expired: tokenAt('expired', now - 1000), valid: tokenAt('valid', now + HOUR) }
    await db.insert(verification).values(Object.values(tokens))

    const { result, statements } = await statementsOf(() => deleteExpiredAuthRows(now))
    expectBudget('deleteExpiredAuthRows', statements, 2)
    // Other files' rows may expire too, so at least ours.
    expect(result.sessions).toBeGreaterThanOrEqual(1)
    expect(result.verifications).toBeGreaterThanOrEqual(1)

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
