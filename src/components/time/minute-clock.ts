const TICK = 60_000

let now = Date.now()
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | undefined

const tick = () => {
  now = Date.now()
  for (const listener of listeners) listener()
}

/** The time, refreshed once a minute while something shows it: `useSyncExternalStore`'s snapshot. */
export const readMinuteClock = (): number => now

/**
 * For `useSyncExternalStore`: `listener` runs once a minute, so relative times ("5 minutes ago") keep up. The
 * timer runs only while there are listeners, and the first one refreshes the time (React reads it again).
 */
export function subscribeToMinuteClock(listener: () => void): () => void {
  if (listeners.size === 0) {
    now = Date.now()
    timer = setInterval(tick, TICK)
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) clearInterval(timer)
  }
}
