// A named fake for Better Auth's server-side session lookup, for the modules that call the `auth` singleton directly
// (src/server/http/request-session.ts) rather than through a Layer.
import { onTestFinished, vi } from 'vitest'
import { auth } from '#/server/auth.ts'

/**
 * Makes `auth.api.getSession` answer "no session" for the rest of the test, and returns a function that lists the
 * cookie each lookup was made with (null for a request without one), in order.
 */
export const recordSessionLookups = (): (() => Array<string | null>) => {
  const getSession = vi.spyOn(auth.api, 'getSession').mockResolvedValue(null)
  onTestFinished(() => {
    getSession.mockRestore()
  })
  return () => getSession.mock.calls.map(([options]) => new Headers(options?.headers).get('cookie'))
}
