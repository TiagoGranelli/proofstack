import '@tanstack/react-start/server-only'
// Aliased: the `use` prefix is Nitro's naming, not a React hook.
import { useNitroHooks as nitroHooks } from 'nitro/app'
import { log } from './log.ts'

type Cleanup = () => Promise<void> | void

const cleanups = new Map<string, Cleanup>()

/**
 * Runs every registered cleanup once Nitro stops: srvx handles SIGTERM/SIGINT, drains in-flight requests
 * and then calls Nitro's `close` hook. One hook runs them all so that `shutdown complete` lists them.
 */
const closeAll = async () => {
  const started = performance.now()
  const entries = [...cleanups]
  cleanups.clear()
  const results = await Promise.allSettled(entries.map(async ([, cleanup]) => cleanup()))
  for (const [index, result] of results.entries()) {
    if (result.status === 'rejected')
      log('error', 'shutdown cleanup failed', { cleanup: entries[index]![0], error: result.reason })
  }
  log('info', 'shutdown complete', {
    cleanups: entries.map(([name]) => name),
    ms: Math.round(performance.now() - started),
  })
}

/**
 * Registers a named cleanup that runs once when the server shuts down. Registered from server code through
 * Nitro's documented `useNitroHooks()` (nitro/app), which resolves to the running Nitro app in the SSR bundle.
 */
export const onShutdown = (name: string, cleanup: Cleanup) => {
  if (cleanups.size === 0) nitroHooks().hook('close', closeAll)
  cleanups.set(name, cleanup)
}
