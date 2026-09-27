import '@tanstack/react-start/server-only'
import { onShutdown } from './lifecycle.ts'
import { log } from './log.ts'

const pending = new Set<Promise<void>>()

/**
 * Runs `task` without making the response wait for it. Better Auth's `advanced.backgroundTasks.handler`
 * (../auth.ts) and the auth mail senders (./mail/auth-mail.ts) use it, so an SMTP round trip, which only
 * happens for accounts that exist, never shows in response times. A failure is logged. Shutdown waits for
 * every pending task.
 */
export const runInBackground = (task: Promise<unknown>): void => {
  const tracked: Promise<void> = task
    .then(
      () => undefined,
      (error: unknown) => log('error', 'background task failed', { error }),
    )
    .finally(() => pending.delete(tracked))
  pending.add(tracked)
}

/** Resolves when no task is pending, including tasks scheduled while waiting. */
export const drainBackgroundTasks = async (): Promise<void> => {
  if (pending.size === 0) return
  await Promise.all(pending)
  return drainBackgroundTasks()
}

onShutdown('background-tasks', drainBackgroundTasks)
