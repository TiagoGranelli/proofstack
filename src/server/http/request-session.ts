import '@tanstack/react-start/server-only'
import { getRequest } from '@tanstack/react-start/server'
import { auth } from '../auth.ts'

type Session = Awaited<ReturnType<typeof auth.api.getSession>>

/** Lookups made while serving one incoming request, by the cookie they were made for. */
const lookups = new WeakMap<Request, Map<string, Promise<Session>>>()

/** The request Start is serving, or undefined outside one (scripts, tests without a request). */
const incomingRequest = (): Request | undefined => {
  try {
    return getRequest()
  } catch {
    return undefined
  }
}

/**
 * The Better Auth session of `headers`' cookie, looked up once per incoming request: an SSR page runs the
 * `_authed` guard (src/lib/session.functions.ts) and then its loaders' API calls, whose Authentication middleware
 * (../api/middleware.ts) asks again with the same cookie, in-process. Both share the first lookup. A trusted
 * server-side read (`auth.api`, no rate limit); Better Auth's cookieCache stays off, so every request still asks
 * the database once and a revoked session ends at once.
 */
export const requestSession = (headers: Headers): Promise<Session> => {
  const request = incomingRequest()
  if (!request) return auth.api.getSession({ headers })
  const cookie = headers.get('cookie') ?? ''
  let byCookie = lookups.get(request)
  if (!byCookie) {
    byCookie = new Map()
    lookups.set(request, byCookie)
  }
  let session = byCookie.get(cookie)
  if (!session) {
    session = auth.api.getSession({ headers })
    byCookie.set(cookie, session)
  }
  return session
}
