import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders, setResponseHeader } from '@tanstack/react-start/server'
import { auth } from '#/server/auth.ts'

interface SessionView {
  readonly user: { readonly id: string; readonly name: string; readonly email: string; readonly emailVerified: boolean }
}

/**
 * Reads the Better Auth session for route guards. Data authorization still happens in the API. A trusted
 * server-side read, so it uses `auth.api` directly (Better Auth does not rate-limit /get-session here either);
 * when the session is due for a refresh, tanstackStartCookies puts the renewed cookie on this response.
 */
export const getSession = createServerFn({ method: 'GET' }).handler(async (): Promise<SessionView | null> => {
  setResponseHeader('cache-control', 'private, no-store')
  const session = await auth.api.getSession({ headers: getRequestHeaders() })
  if (!session) return null
  const { id, name, email, emailVerified } = session.user
  return { user: { id, name, email, emailVerified } }
})
