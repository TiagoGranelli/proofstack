import '@tanstack/react-start/server-only'
import { getRequestHeaders, getRequestIP, getResponseHeaders } from '@tanstack/react-start/server'
import { auth } from '../auth.ts'
import { env } from '../env.ts'
import { log } from '../log.ts'
import { AUTH_BASE_PATH, isHttpEndpoint, notFound } from './auth-endpoints.ts'
import { forwardedFor } from './forwarded-for.ts'

/**
 * Request headers as Better Auth must see them: the TCP peer becomes the last X-Forwarded-For hop
 * (see forwarded-for.ts). This is the only place the client IP enters the app.
 */
const withPeerAddress = (source: Headers): Headers => {
  const headers = new Headers(source)
  const chain = forwardedFor(headers.get('x-forwarded-for'), getRequestIP(), env.trustedProxies.length > 0)
  if (chain) headers.set('x-forwarded-for', chain)
  else headers.delete('x-forwarded-for')
  return headers
}

/**
 * Better Auth's router, which applies disabledPaths, the endpoint allowlist, rate limiting and the origin check.
 * Unexpected failures (for example, the database is down) are thrown (`onAPIError.throw` in ../auth.ts) and
 * logged here without the request, as an empty 500. Auth failures such as a wrong password answer normally.
 */
const dispatch = async (request: Request): Promise<Response> => {
  try {
    return await auth.handler(request)
  } catch (error) {
    log('error', 'auth request failed', { path: new URL(request.url).pathname, error })
    return new Response(null, { status: 500, headers: { 'cache-control': 'no-store' } })
  }
}

/** What a Better Auth endpoint answered to callAuthEndpoint. */
export type AuthEndpointResult =
  | { readonly ok: true; readonly body: unknown }
  | {
      readonly ok: false
      readonly status: number
      /** Better Auth's error code (`INVALID_EMAIL_OR_PASSWORD`, ...), when the body carries one. */
      readonly code: string | undefined
      /** Seconds until a rate-limited client may retry. */
      readonly retryAfter: number | undefined
    }

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/**
 * Calls a Better Auth endpoint from a server function, as the client of the current request. It goes through
 * Better Auth's router, like /api/auth/*: the endpoint allowlist, rate limiting, the origin check and the client
 * IP apply. `auth.api.*` would skip all of them (Better Auth does not rate-limit server-side calls), which is
 * right for trusted reads but not for actions a browser triggers. Set-Cookie headers are copied onto the
 * server function's response.
 */
export const callAuthEndpoint = async (
  method: 'GET' | 'POST',
  path: `/${string}`,
  input: { readonly body?: Record<string, unknown>; readonly query?: Record<string, string> } = {},
): Promise<AuthEndpointResult> => {
  const url = new URL(`${AUTH_BASE_PATH}${path}`, env.appUrl)
  for (const [name, value] of Object.entries(input.query ?? {})) url.searchParams.set(name, value)
  const headers = withPeerAddress(new Headers(getRequestHeaders()))
  // The incoming request's body headers describe the server function call, not this one.
  for (const name of ['content-length', 'content-type', 'transfer-encoding']) headers.delete(name)
  if (input.body) headers.set('content-type', 'application/json')
  const response = await dispatch(
    new Request(url, { method, headers, ...(input.body ? { body: JSON.stringify(input.body) } : {}) }),
  )

  const outgoing = getResponseHeaders()
  for (const cookie of response.headers.getSetCookie()) outgoing.append('set-cookie', cookie)

  const body = parseJson(await response.text())
  if (response.ok) return { ok: true, body }
  const code =
    typeof body === 'object' && body !== null && 'code' in body && typeof body.code === 'string' ? body.code : undefined
  const retryAfter = Number(response.headers.get('x-retry-after'))
  return {
    ok: false,
    status: response.status,
    code,
    retryAfter: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
  }
}

/**
 * The session token stays in the HttpOnly cookie: Better Auth also puts it in the JSON of sign-in (`token`)
 * and get-session (`session.token`), where page scripts could read it. Removed from those bodies.
 */
const withoutSessionTokens = async (response: Response): Promise<Response> => {
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return response
  const body: unknown = parseJson(await response.text())
  if (typeof body === 'object' && body !== null) {
    if ('token' in body) delete body.token
    if ('session' in body && typeof body.session === 'object' && body.session !== null && 'token' in body.session)
      delete body.session.token
  }
  const headers = new Headers(response.headers)
  headers.delete('content-length')
  return new Response(JSON.stringify(body), { status: response.status, statusText: response.statusText, headers })
}

/**
 * Handles /api/auth/* for the Start route in src/routes/api/auth/$.ts. Only the endpoints a client without the
 * UI needs reach Better Auth (HTTP_ENDPOINTS in ./auth-endpoints.ts); the rest answer 404 before it runs, so
 * they are neither counted by the rate limit nor stored.
 */
export const handleAuthRequest = async (request: Request): Promise<Response> => {
  if (!isHttpEndpoint(request)) return notFound()
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
  // A fresh Request: the incoming one is srvx's Node request wrapper, whose headers cannot be replaced.
  const response = await dispatch(
    new Request(request.url, {
      method: request.method,
      headers: withPeerAddress(request.headers),
      signal: request.signal,
      ...(hasBody ? { body: request.body, duplex: 'half' } : {}),
    }),
  )
  return withoutSessionTokens(response)
}
