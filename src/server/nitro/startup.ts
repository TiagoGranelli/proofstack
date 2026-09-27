import { definePlugin } from 'nitro'
// Importing env validates the configuration while the server starts, before it accepts traffic.
// Without this import the first request would be the first to notice a missing variable.
import { env } from '../env.ts'
import { log } from '../log.ts'

export default definePlugin((nitroApp) => {
  log('info', 'starting', {
    appUrl: env.appUrl,
    trustedIpHeader: env.trustedIpHeader ?? null,
    databasePoolMax: env.databasePoolMax,
  })

  // Nitro's `error` hook receives every error it captures: failures in the request pipeline (Nitro answers
  // them with a bare JSON 500) and, tagged `uncaughtException` or `unhandledRejection`, the process-level
  // ones it traps. Nitro only logs an uncaught exception and keeps serving; after one, process state is
  // unknown, so log it and exit non-zero for the supervisor to restart a clean process.
  nitroApp.hooks.hook('error', (error, { event, tags = [] }) => {
    if (tags.includes('uncaughtException')) {
      log('error', 'uncaught exception, exiting', { error })
      process.exit(1)
    }
    if (tags.includes('unhandledRejection')) return log('error', 'unhandled rejection', { error })
    log('error', 'request error', {
      tags,
      ...(event ? { method: event.req.method, path: new URL(event.req.url).pathname } : {}),
      error,
    })
  })
})
