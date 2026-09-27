import { createServerOnlyFn } from '@tanstack/react-start'
import { env } from '#/server/env.ts'

/**
 * The public origin of the app: APP_URL, validated once when the server starts (src/server/env.ts, loaded by
 * the startup plugin, which stops the process when it is missing or not an origin). For the request middleware
 * in src/start.ts, which is isomorphic: Start's compiler replaces this function with a stub in client bundles,
 * so server configuration never reaches them.
 */
export const appOrigin = createServerOnlyFn(() => env.appUrl)
