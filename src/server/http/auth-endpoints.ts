import '@tanstack/react-start/server-only'
import type { BetterAuthPlugin } from 'better-auth'
import { env } from '../env.ts'

/** Where Better Auth's HTTP router is mounted (src/routes/api/auth/$.ts). */
export const AUTH_BASE_PATH = '/api/auth'

/**
 * The Better Auth endpoints this app uses, as `METHOD /path` below AUTH_BASE_PATH: the server functions in
 * src/lib/auth.functions.ts call them, and GET /get-session serves API clients. Everything else Better Auth
 * ships (update-user, change-email, verify-password, the reset-password link callback, OAuth callbacks without
 * providers, ...) answers 404. Add an endpoint here only together with the UI that calls it.
 */
const EXPOSED = new Set([
  'GET /get-session',
  'POST /sign-in/email',
  'POST /sign-out',
  // Only with AUTH_SIGN_UP=open; closed also lists it in disabledPaths (../auth.ts).
  ...(env.authSignUp === 'open' ? ['POST /sign-up/email'] : []),
  'POST /send-verification-email',
  'GET /verify-email',
  'POST /request-password-reset',
  'POST /reset-password',
  'POST /change-password',
  'GET /list-sessions',
  'POST /revoke-session',
  'POST /revoke-other-sessions',
  'POST /revoke-sessions',
  'POST /delete-user',
])

/** Whether a request targets an exposed endpoint. The path must match exactly: no trailing slash, no `//`. */
export const isExposedEndpoint = (request: Request): boolean => {
  const { pathname } = new URL(request.url)
  return (
    pathname.startsWith(`${AUTH_BASE_PATH}/`) &&
    EXPOSED.has(`${request.method} ${pathname.slice(AUTH_BASE_PATH.length)}`)
  )
}

/**
 * Keeps Better Auth's HTTP surface to the exposed endpoints (404 for the rest) and marks every auth response
 * `no-store`. Runs in Better Auth's router, so it covers /api/auth/* and the in-process calls made by server
 * functions alike. Better Auth has no built-in endpoint allowlist yet (better-auth#11078).
 */
export const endpointAllowlist = (): BetterAuthPlugin => ({
  id: 'proofstack-endpoint-allowlist',
  onRequest: async (request) =>
    isExposedEndpoint(request)
      ? undefined
      : { response: new Response('Not Found', { status: 404, headers: { 'cache-control': 'no-store' } }) },
  onResponse: async (response) => {
    if (response.headers.has('cache-control')) return undefined
    const headers = new Headers(response.headers)
    headers.set('cache-control', 'no-store')
    return {
      response: new Response(response.body, { status: response.status, statusText: response.statusText, headers }),
    }
  },
})
