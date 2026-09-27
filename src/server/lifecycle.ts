import '@tanstack/react-start/server-only'
import { log } from './log.ts'

type Cleanup = () => Promise<void> | void

/**
 * What shutdown releases, in the order it runs, one step at a time: the periodic auth cleanup stops scheduling
 * passes, pending background tasks (mail sends, rate-limit pruning, a running cleanup pass, and Better Auth work
 * whose client disconnected) still query the database or use the mail transport, so they finish before the mail
 * transport closes, and the Effect runtime and the Postgres pool go last.
 */
const STEPS = ['auth-cleanup', 'background-tasks', 'mailer', 'effect-api', 'postgres-pool'] as const
export type ShutdownStep = (typeof STEPS)[number]

// Nitro bundles its plugins (src/server/nitro/startup.ts, which runs the steps) apart from the SSR code that
// registers them, so this module can exist twice in .output/server. The registry and the draining flag live on
// globalThis, where both copies find the same ones.
const REGISTRY = Symbol.for('app.shutdown')
const DRAINING = Symbol.for('app.draining')
const shared = globalThis as { [REGISTRY]?: Map<ShutdownStep, Cleanup>; [DRAINING]?: boolean }
const registry = (shared[REGISTRY] ??= new Map<ShutdownStep, Cleanup>())

/**
 * Whether the process is shutting down: set when SIGTERM or SIGINT arrives (src/server/nitro/startup.ts), before
 * srvx drains. `/api/ready` then answers 503, and every response closes its connection (src/server/nitro/http.ts).
 */
export const isDraining = (): boolean => shared[DRAINING] === true
/** Marks the process as draining (or not): see `isDraining`. */
export const setDraining = (draining: boolean): void => {
  shared[DRAINING] = draining
}

/**
 * Registers the cleanup of one shutdown step; a second registration of the same step replaces the first.
 * Nothing here depends on Nitro, so CLI scripts (scripts/create-user.ts) can import server modules that
 * register steps: without a server, nothing runs them, and the scripts release what they opened themselves.
 */
export const onShutdown = (step: ShutdownStep, cleanup: Cleanup): void => {
  registry.set(step, cleanup)
}

/** Runs one step's cleanup and returns how long it took, in ms. A failure is logged, not thrown. */
const runStep = async (step: ShutdownStep, cleanup: Cleanup): Promise<number> => {
  const started = performance.now()
  try {
    await cleanup()
  } catch (error) {
    log('error', 'shutdown cleanup failed', { cleanup: step, error })
  }
  return Math.round(performance.now() - started)
}

/**
 * Runs the registered steps once, in STEPS order, each after the previous one settled. A failed step is
 * logged and does not stop the ones after it. The `shutdown complete` line lists the steps in the order they
 * ran. Called from Nitro's `close` hook (src/server/nitro/startup.ts): srvx handles SIGTERM/SIGINT, drains
 * in-flight requests, then closes Nitro.
 */
export const runShutdown = async (): Promise<void> => {
  const started = performance.now()
  const ran: { step: ShutdownStep; ms: number }[] = []
  for (const step of STEPS) {
    const cleanup = registry.get(step)
    if (!cleanup) continue
    registry.delete(step)
    // One step at a time on purpose: each one may still need what the later ones release.
    // oxlint-disable-next-line no-await-in-loop
    ran.push({ step, ms: await runStep(step, cleanup) })
  }
  log('info', 'shutdown complete', {
    cleanups: ran.map(({ step }) => step),
    steps: ran,
    ms: Math.round(performance.now() - started),
  })
}
