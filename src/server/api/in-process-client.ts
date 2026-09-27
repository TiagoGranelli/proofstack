import '@tanstack/react-start/server-only'
import { getRequestHeader } from '@tanstack/react-start/server'
import { type Client, createClient } from '#/sdk/client/index.ts'
import { env } from '../env.ts'
import { apiHandler } from './web-handler.ts'

/**
 * Only reads: a write in-process would carry the page request's cookie past the CSRF check and the body limit
 * (src/start.ts), which guard only requests that arrive over HTTP. SSR loaders read; writes come from the browser.
 */
const dispatch = (request: Request): Promise<Response> => {
  if (request.method !== 'GET')
    throw new Error(
      `The in-process API client only sends GET (got ${request.method} ${new URL(request.url).pathname}): ` +
        'call a write from the browser, where the CSRF check applies.',
    )
  return apiHandler(request)
}

/**
 * SDK client for SSR. Requests go through the same contract, validation and middleware as HTTP
 * calls, but are dispatched in-process to the Effect handler. The base URL equals the browser's
 * origin so TanStack Query keys (which include it) match after hydration.
 */
export const createInProcessApiClient = (): Client => {
  const cookie = getRequestHeader('cookie')
  return createClient({
    baseUrl: env.appUrl,
    fetch: (input, init) => dispatch(new Request(input, init)),
    ...(cookie ? { headers: { cookie } } : {}),
  })
}
