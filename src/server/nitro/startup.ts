import { definePlugin } from 'nitro'
// Importing env validates the configuration while the server starts, before it accepts traffic.
// Without this import the first request would be the first to notice a missing variable.
import { env } from '../env.ts'
import { captureConsole, log } from '../log.ts'

export default definePlugin(() => {
  // Production only: in development the raw, multi-line output is what you want to read.
  if (process.env.NODE_ENV === 'production') captureConsole()
  log('info', 'starting', {
    appUrl: env.appUrl,
    trustedProxies: env.trustedProxies,
    databasePoolMax: env.databasePoolMax,
  })

  // Nitro only logs uncaught exceptions and keeps serving. After one, process state is unknown:
  // log it and exit non-zero so the supervisor restarts a clean process.
  process.on('uncaughtException', (error) => {
    log('error', 'uncaught exception, exiting', { error })
    process.exit(1)
  })
  process.on('unhandledRejection', (error) => log('error', 'unhandled rejection', { error }))
})
