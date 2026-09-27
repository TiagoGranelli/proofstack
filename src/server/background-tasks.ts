import '@tanstack/react-start/server-only'
import { onShutdown } from './lifecycle.ts'
import { log } from './log.ts'

const pending = new Set<Promise<void>>()

/** Keeps `settled` (a promise that never rejects) in `pending` until it settles. */
const track = (settled: Promise<void>) => {
  const tracked: Promise<void> = settled.finally(() => pending.delete(tracked))
  pending.add(tracked)
}

/**
 * Runs `task` without making the response wait for it. Better Auth's `advanced.backgroundTasks.handler`
 * (../auth.ts) and the auth mail senders (./mail/auth-mail.ts) use it, so an SMTP round trip, which only
 * happens for accounts that exist, never shows in response times. A failure is logged. Shutdown waits for
 * every pending task
 * before it closes the mail transport and the database pool (../lifecycle.ts).
 */
export const runInBackground = (task: Promise<unknown>): void => {
  track(
    task.then(
      () => undefined,
      (error: unknown) => log('error', 'background task failed', { error }),
    ),
  )
}

/**
 * Returns `work` as it is, and makes shutdown wait for it like a background task. For work a request starts that
 * can outlive the request: when a client disconnects during a sign-in, the response settles at once (logged as
 * 499 about 10 ms in), but Better Auth's handler keeps hashing the password and then writes the session. Without
 * this, a SIGTERM at that moment closed the pool under it ("Failed query: insert into session", found by a load
 * test and reproduced by tests/integration/shutdown.test.ts).
 */
export const finishBeforeShutdown = <A>(work: Promise<A>): Promise<A> => {
  // The caller handles the failure; the tracked copy only waits.
  track(
    work.then(
      () => undefined,
      () => undefined,
    ),
  )
  return work
}

/** Resolves when no task is pending, including tasks scheduled while waiting. */
const drainBackgroundTasks = async (): Promise<void> => {
  if (pending.size === 0) return
  await Promise.all(pending)
  return drainBackgroundTasks()
}

onShutdown('background-tasks', drainBackgroundTasks)
