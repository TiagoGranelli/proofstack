import '@tanstack/react-start/server-only'
import { getRequestHeader } from '@tanstack/react-start/server'
import { createClient } from '#/sdk/client/index.ts'
import { env } from '../env.ts'
import { apiHandler } from './web-handler.ts'

/**
 * SDK client for SSR. Requests go through the same contract, validation and middleware as HTTP
 * calls, but are dispatched in-process to the Effect handler. The base URL equals the browser's
 * origin so TanStack Query keys (which include it) match after hydration.
 */
export const createInProcessApiClient = () => {
  const cookie = getRequestHeader('cookie')
  return createClient({
    baseUrl: env.appUrl,
    fetch: (input, init) => apiHandler(new Request(input, init)),
    ...(cookie ? { headers: { cookie } } : {}),
  })
}
