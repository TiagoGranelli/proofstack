import { definePlugin } from 'nitro'
import { log } from '../log.ts'

type Cleanup = () => Promise<void> | void

// Runs cleanups registered through src/server/lifecycle.ts after Nitro stops accepting connections
// and in-flight requests finish (srvx handles SIGTERM/SIGINT and then calls the `close` hook).
// This plugin is bundled separately from the SSR code, so the registry is shared through globalThis.
export default definePlugin((nitroApp) => {
  nitroApp.hooks.hook('close', async () => {
    const started = performance.now()
    const registry = (globalThis as { __proofstackShutdown?: Map<string, Cleanup> }).__proofstackShutdown
    const entries = registry ? [...registry] : []
    const results = await Promise.allSettled(entries.map(async ([, cleanup]) => cleanup()))
    for (const [index, result] of results.entries()) {
      if (result.status === 'rejected')
        log('error', 'shutdown cleanup failed', { cleanup: entries[index]![0], error: result.reason })
    }
    registry?.clear()
    log('info', 'shutdown complete', {
      cleanups: entries.map(([name]) => name),
      ms: Math.round(performance.now() - started),
    })
  })
})
