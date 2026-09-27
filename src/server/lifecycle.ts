import '@tanstack/react-start/server-only'
import { log } from './log.ts'

type Cleanup = () => Promise<void> | void

/**
 * What shutdown releases, in the order it runs, one step at a time: pending background tasks (mail sends,
 * rate-limit pruning) still query the database or use the mail transport, so they finish before the mail
 * transport closes, and the Effect runtime and the Postgres pool go last.
 */
const STEPS = ['background-tasks', 'mailer', 'effect-api', 'postgres-pool'] as const
export type ShutdownStep = (typeof STEPS)[number]

// Nitro bundles its plugins (src/server/nitro/startup.ts, which runs the steps) apart from the SSR code that
// registers them, so this module can exist twice in .output/server. The registry lives on globalThis, where
// both copies find the same one.
const REGISTRY = Symbol.for('proofstack.shutdown')
const registry = ((globalThis as { [REGISTRY]?: Map<ShutdownStep, Cleanup> })[REGISTRY] ??= new Map())

/**
 * Registers the cleanup of one shutdown step; a second registration of the same step replaces the first.
 * Nothing here depends on Nitro, so CLI scripts (scripts/create-user.ts) can import server modules that
 * register steps: without a server, nothing runs them, and the scripts release what they opened themselves.
 */
export const onShutdown = (step: ShutdownStep, cleanup: Cleanup) => {
  registry.set(step, cleanup)
}

/**
 * Runs the registered steps once, in STEPS order, each after the previous one settled. A failed step is
 * logged and does not stop the ones after it. The `shutdown complete` line lists the steps in the order they
 * ran. Called from Nitro's `close` hook (src/server/nitro/startup.ts): srvx handles SIGTERM/SIGINT, drains
 * in-flight requests, then closes Nitro.
 */
export const runShutdown = async () => {
  const started = performance.now()
  const ran: { step: ShutdownStep; ms: number }[] = []
  for (const step of STEPS) {
    const cleanup = registry.get(step)
    if (!cleanup) continue
    registry.delete(step)
    const stepStarted = performance.now()
    try {
      // One step at a time on purpose: each one may still need what the later ones release.
      // oxlint-disable-next-line no-await-in-loop
      await cleanup()
    } catch (error) {
      log('error', 'shutdown cleanup failed', { cleanup: step, error })
    }
    ran.push({ step, ms: Math.round(performance.now() - stepStarted) })
  }
  log('info', 'shutdown complete', {
    cleanups: ran.map(({ step }) => step),
    steps: ran,
    ms: Math.round(performance.now() - started),
  })
}
