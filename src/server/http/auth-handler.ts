import '@tanstack/react-start/server-only'
import { auth } from '../auth.ts'
import { log } from '../log.ts'
import { CLIENT_IP_HEADER, resolveClientIp } from './client-ip.ts'

const BASE_PATH = '/api/auth'

/**
 * Better Auth endpoints reachable over HTTP: exactly what the UI calls. Everything else Better Auth
 * ships (sign-up, password reset and email verification without a mail sender, OAuth callbacks
 * without providers, update-user, change-email, delete-user, verify-password, ...) answers 404.
 * Add a line here only together with the UI and configuration that needs it. For example,
 * `POST /change-password` comes back with a change-password form that sends
 * `revokeOtherSessions: true`, and `GET /list-sessions` plus `POST /revoke-session(s)` with a
 * sessions page.
 */
const ALLOWED = new Set(['POST /sign-in/email', 'POST /sign-out', 'GET /get-session'])

const notFound = () => new Response('Not Found', { status: 404, headers: { 'cache-control': 'no-store' } })

/** Handles /api/auth/* for the Start route in src/routes/api/auth/$.ts. */
export const handleAuthRequest = async (request: Request): Promise<Response> => {
  const { pathname } = new URL(request.url)
  if (!pathname.startsWith(`${BASE_PATH}/`)) return notFound()
  if (!ALLOWED.has(`${request.method} ${pathname.slice(BASE_PATH.length)}`)) return notFound()

  const headers = new Headers(request.headers)
  headers.delete(CLIENT_IP_HEADER)
  const ip = resolveClientIp(request)
  if (ip) headers.set(CLIENT_IP_HEADER, ip)
  // A fresh Request: the incoming one is srvx's Node request wrapper, which undici cannot clone.
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
  const forwarded = new Request(request.url, {
    method: request.method,
    headers,
    signal: request.signal,
    ...(hasBody ? { body: request.body, duplex: 'half' } : {}),
  })

  let response: Response
  try {
    response = await auth.handler(forwarded)
  } catch (error) {
    log('error', 'auth request failed', { path: pathname, error })
    return new Response(null, { status: 500, headers: { 'cache-control': 'no-store' } })
  }

  if (!response.headers.has('cache-control')) response.headers.set('cache-control', 'no-store')
  return response
}
