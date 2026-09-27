import '@tanstack/react-start/server-only'
import { lt } from 'drizzle-orm'
import { runInBackground } from './background-tasks.ts'
import { db } from './db/client.ts'
import { session, verification } from './db/schema/auth.ts'
import { onShutdown } from './lifecycle.ts'
import { log } from './log.ts'

/**
 * How long an expired session is kept. Better Auth (1.7.6) deletes an expired session only when its token comes
 * back, so a user who never returns would otherwise keep their IP address and user agent in the table forever.
 */
export const EXPIRED_SESSION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
/** How often each server process runs the cleanup. Both deletes use an index on expires_at. */
const INTERVAL_MS = 10 * 60 * 1000

/**
 * Deletes sessions that expired more than EXPIRED_SESSION_RETENTION_MS ago and verification tokens (email
 * confirmation, password reset) that have expired. Returns how many rows each delete removed.
 */
export const deleteExpiredAuthRows = async (now = Date.now()) => {
  const sessions = await db.delete(session).where(lt(session.expiresAt, new Date(now - EXPIRED_SESSION_RETENTION_MS)))
  const verifications = await db.delete(verification).where(lt(verification.expiresAt, new Date(now)))
  return { sessions: sessions.rowCount ?? 0, verifications: verifications.rowCount ?? 0 }
}

let timer: NodeJS.Timeout | undefined

const cleanUp = async () => {
  const deleted = await deleteExpiredAuthRows()
  if (deleted.sessions || deleted.verifications) log('info', 'expired auth rows deleted', deleted)
}

/**
 * Runs deleteExpiredAuthRows every INTERVAL_MS as a background task (./background-tasks.ts), from when the
 * auth module loads (../auth.ts). The timer does not keep a process alive (CLI scripts load the same module),
 * and shutdown stops it before it drains the background tasks, so no pass starts after the pool is closing.
 */
export const scheduleAuthCleanup = () => {
  if (timer) return
  timer = setInterval(() => runInBackground(cleanUp()), INTERVAL_MS).unref()
  onShutdown('auth-cleanup', () => {
    clearInterval(timer)
    timer = undefined
  })
}
