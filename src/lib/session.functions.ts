import { createIsomorphicFn, createServerFn } from '@tanstack/react-start'
import { getRequestHeaders, setResponseHeader } from '@tanstack/react-start/server'
import { requestSession } from '#/server/http/request-session.ts'

/** The signed-in user, as route guards and the site header need it. */
export type SignedInSession = {
  readonly user: { readonly id: string; readonly name: string; readonly email: string; readonly emailVerified: boolean }
}

/**
 * Reads the Better Auth session for route guards. Data authorization still happens in the API. A trusted
 * server-side read (Better Auth does not rate-limit /get-session here either), shared with the API calls of the
 * same SSR request (requestSession); when the session is due for a refresh, tanstackStartCookies puts the
 * renewed cookie on this response.
 */
export const getSession = createServerFn({ method: 'GET' }).handler(async (): Promise<SignedInSession | null> => {
  setResponseHeader('cache-control', 'private, no-store')
  const session = await requestSession(getRequestHeaders())
  if (!session) return null
  const { id, name, email, emailVerified } = session.user
  return { user: { id, name, email, emailVerified } }
})

/**
 * Whether this render is Nitro prerendering a page at build time (ADR 0004), which it marks with the
 * `x-nitro-prerender` request header: there is no visitor, so there is no session to read. A browser that sends
 * the header only gets a page that does not know who it is.
 */
export const isPrerendering = createIsomorphicFn()
  .server((): boolean => getRequestHeaders().has('x-nitro-prerender'))
  .client((): boolean => false)
