import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders, setResponseHeader } from '@tanstack/react-start/server'
import { requestSession } from '#/server/http/request-session.ts'

interface SessionView {
  readonly user: { readonly id: string; readonly name: string; readonly email: string; readonly emailVerified: boolean }
}

/**
 * Reads the Better Auth session for route guards. Data authorization still happens in the API. A trusted
 * server-side read (Better Auth does not rate-limit /get-session here either), shared with the API calls of the
 * same SSR request (requestSession); when the session is due for a refresh, tanstackStartCookies puts the
 * renewed cookie on this response.
 */
export const getSession = createServerFn({ method: 'GET' }).handler(async (): Promise<SessionView | null> => {
  setResponseHeader('cache-control', 'private, no-store')
  const session = await requestSession(getRequestHeaders())
  if (!session) return null
  const { id, name, email, emailVerified } = session.user
  return { user: { id, name, email, emailVerified } }
})
