import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders, setResponseHeader } from '@tanstack/react-start/server'
import { auth } from '#/server/auth.ts'

interface SessionView {
  readonly user: { readonly id: string; readonly name: string; readonly email: string }
}

/** Reads the Better Auth session for route guards. Data authorization still happens in the API. */
export const getSession = createServerFn({ method: 'GET' }).handler(async (): Promise<SessionView | null> => {
  setResponseHeader('cache-control', 'private, no-store')
  const session = await auth.api.getSession({ headers: getRequestHeaders() })
  if (!session) return null
  const { id, name, email } = session.user
  return { user: { id, name, email } }
})
