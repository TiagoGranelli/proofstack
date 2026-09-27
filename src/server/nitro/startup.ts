import { definePlugin } from 'nitro'
import type { NitroRuntimeHooks } from 'nitro/types'
// Importing env validates the configuration while the server starts, before it accepts traffic.
// Without this import the first request would be the first to notice a missing variable.
import { env } from '../env.ts'
import { runShutdown, setDraining } from '../lifecycle.ts'
import { log } from '../log.ts'

// Nitro's `error` hook receives every error it captures: failures in the request pipeline (Nitro answers
// them with a bare JSON 500) and, tagged `uncaughtException` or `unhandledRejection`, the process-level
// ones it traps. Nitro only logs an uncaught exception and keeps serving; after one, process state is
// unknown, so log it and exit non-zero for the supervisor to restart a clean process.
const onError: NitroRuntimeHooks['error'] = (error, { event, tags = [] }) => {
  if (tags.includes('uncaughtException')) {
    log('error', 'uncaught exception, exiting', { error })
    process.exit(1)
  }
  if (tags.includes('unhandledRejection')) {
    log('error', 'unhandled rejection', { error })
    return
  }
  log('error', 'request error', {
    tags,
    ...(event ? { method: event.req.method, path: new URL(event.req.url).pathname } : {}),
    error,
  })
}

export default definePlugin((nitroApp) => {
  log('info', 'starting', {
    appUrl: env.appUrl,
    trustedProxies: env.trustedProxies,
    databasePoolMax: env.databasePoolMax,
    databaseUrlPooled: env.databaseUrlPooled,
    // Whether Node's permission model restricts the process (the image's CMD, scripts/app-server.ts).
    permissionModel: process.execArgv.includes('--permission'),
  })

  // srvx handles SIGTERM/SIGINT, drains in-flight requests, then closes Nitro: release what server code
  // registered with onShutdown (../lifecycle.ts), step by step.
  nitroApp.hooks.hook('close', runShutdown)

  // From the signal on, /api/ready answers 503 and responses close their connections (../lifecycle.ts). srvx
  // handles the signals unless CI or TEST is set (its gracefulShutdownPlugin), and only then may this listen
  // too: any listener replaces Node's default of exiting on the signal.
  if (!process.env.CI && !process.env.TEST)
    for (const signal of ['SIGTERM', 'SIGINT'] as const)
      process.once(signal, () => {
        setDraining(true)
        log('info', 'draining', { signal })
      })

  nitroApp.hooks.hook('error', onError)
})
