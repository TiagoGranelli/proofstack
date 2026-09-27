import '@tanstack/react-start/server-only'
import type { BetterAuthPlugin } from 'better-auth'
import { env } from '../env.ts'

/** Where Better Auth's HTTP router is mounted (src/routes/api/auth/$.ts). */
export const AUTH_BASE_PATH = '/api/auth'

type Endpoint = `${'GET' | 'POST'} /${string}`

/**
 * What /api/auth/* answers from outside: only what a client without the UI needs to use the business API,
 * whose endpoints authenticate with Better Auth's session cookie (src/contract/middleware.ts). Such a client
 * (an API consumer, scripts/lighthouse.ts, the test suites) signs in for the cookie, reads its session and
 * signs out. The request each of them takes is the one the UI's server function sends, so exposing them adds
 * nothing a browser could not already do. Account management stays behind the server functions, which accept
 * a narrower input than Better Auth: over raw HTTP, POST /delete-user deletes without the password while the
 * session is fresh, and GET /list-sessions returns every session token to page scripts.
 */
const HTTP_ENDPOINTS = new Set<Endpoint>(['GET /get-session', 'POST /sign-in/email', 'POST /sign-out'])

/**
 * The Better Auth endpoints this app uses, as `METHOD /path` below AUTH_BASE_PATH: HTTP_ENDPOINTS and what the
 * server functions in src/lib/auth.functions.ts call in-process (callAuthEndpoint). Everything else Better Auth
 * ships (update-user, change-email, verify-password, the reset-password link callback, OAuth callbacks without
 * providers, ...) answers 404 on both paths. Add an endpoint here only together with the server function that
 * calls it, and to HTTP_ENDPOINTS only for a client that cannot use a server function.
 */
const EXPOSED = new Set<Endpoint>([
  ...HTTP_ENDPOINTS,
  // Only with AUTH_SIGN_UP=open; closed also lists it in disabledPaths (../auth.ts).
  ...(env.authSignUp === 'open' ? (['POST /sign-up/email'] as const) : []),
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

/** The request's endpoint as `METHOD /path` below AUTH_BASE_PATH; the path must match exactly (no trailing `/`). */
const endpointOf = (request: Request): string | undefined => {
  const { pathname } = new URL(request.url)
  return pathname.startsWith(`${AUTH_BASE_PATH}/`)
    ? `${request.method} ${pathname.slice(AUTH_BASE_PATH.length)}`
    : undefined
}

const has = (set: ReadonlySet<string>, endpoint: string | undefined) => endpoint !== undefined && set.has(endpoint)

/** Whether a request targets an endpoint the app uses (in-process or over HTTP). */
export const isExposedEndpoint = (request: Request): boolean => has(EXPOSED, endpointOf(request))

/** Whether a request that arrived at /api/auth/* over HTTP may reach Better Auth (./auth-handler.ts). */
export const isHttpEndpoint = (request: Request): boolean => has(HTTP_ENDPOINTS, endpointOf(request))

/** The answer for every endpoint the app does not expose. */
export const notFound = () => new Response('Not Found', { status: 404, headers: { 'cache-control': 'no-store' } })

/**
 * Keeps Better Auth's surface to the exposed endpoints (404 for the rest) and marks every auth response
 * `no-store`. Runs in Better Auth's router, so it covers /api/auth/* and the in-process calls made by server
 * functions alike; /api/auth/* is narrowed further to HTTP_ENDPOINTS before Better Auth sees the request.
 * Better Auth has no built-in endpoint allowlist yet (better-auth#11078).
 */
export const endpointAllowlist = (): BetterAuthPlugin => ({
  id: 'endpoint-allowlist',
  onRequest: async (request) => (isExposedEndpoint(request) ? undefined : { response: notFound() }),
  onResponse: async (response) => {
    if (response.headers.has('cache-control')) return undefined
    const headers = new Headers(response.headers)
    headers.set('cache-control', 'no-store')
    return {
      response: new Response(response.body, { status: response.status, statusText: response.statusText, headers }),
    }
  },
})
