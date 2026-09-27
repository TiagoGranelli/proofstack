import { isNotFound, isRedirect } from '@tanstack/react-router'
import { createMiddleware } from '@tanstack/react-start'
import { log } from '#/server/log.ts'

/**
 * Global function middleware (src/start.ts): runs around every server function, whether the browser calls
 * it or SSR does. Start serializes whatever a server function throws to the client, message included, so a
 * raw Better Auth or database error would reach the browser with its SQL and parameters. Redirects and
 * not-found pass through untouched; any other error is logged through `log` (first line, stack frames,
 * no parameters) and replaced by a generic error.
 */
export const serverFunctionErrors = createMiddleware({ type: 'function' }).server(async ({ next, serverFnMeta }) => {
  try {
    return await next()
  } catch (error) {
    if (isRedirect(error) || isNotFound(error)) throw error
    log('error', 'server function failed', { fn: serverFnMeta.name, error })
    // No `cause` on purpose: the original error stays on the server, in the log line above.
    // oxlint-disable-next-line preserve-caught-error
    throw new Error('Internal error')
  }
})
