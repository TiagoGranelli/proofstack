import '@tanstack/react-start/server-only'
import { getRequestHeaders, getRequestIP, getResponseHeaders } from '@tanstack/react-start/server'
import type { BASE_ERROR_CODES } from 'better-auth'
import { auth } from '../auth.ts'
import { finishBeforeShutdown } from '../background-tasks.ts'
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
 * Shutdown waits for it even when its client disconnected (../background-tasks.ts).
 */
const dispatch = async (request: Request): Promise<Response> => {
  try {
    return await finishBeforeShutdown(auth.handler(request))
  } catch (error) {
    log('error', 'auth request failed', { path: new URL(request.url).pathname, error })
    return new Response(null, { status: 500, headers: { 'cache-control': 'no-store' } })
  }
}

/**
 * Every error code the exposed endpoints (./auth-endpoints.ts) can answer with for the input the server functions
 * send, read from Better Auth 1.7.6's routes and middleware (api/routes/*.mjs, origin-check.mjs, better-call's
 * validation). Each is checked against Better Auth's exported BASE_ERROR_CODES, so an upstream rename fails the
 * typecheck; UNAUTHORIZED is the one literal its session middleware throws outside that list. A code outside this
 * list is logged and reported as undefined (the UI says "something went wrong").
 */
const BETTER_AUTH_CODES = [
  // Any POST: the origin check, and the form CSRF check of sign-in and sign-up.
  'INVALID_ORIGIN',
  'MISSING_OR_NULL_ORIGIN',
  'CROSS_SITE_NAVIGATION_LOGIN_BLOCKED',
  'VALIDATION_ERROR',
  // Sign-in and sign-up.
  'INVALID_EMAIL',
  'INVALID_EMAIL_OR_PASSWORD',
  'EMAIL_NOT_VERIFIED',
  'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL',
  'FAILED_TO_CREATE_USER',
  'FAILED_TO_CREATE_SESSION',
  // New passwords (sign-up, reset, change).
  'PASSWORD_TOO_SHORT',
  'PASSWORD_TOO_LONG',
  // Links: verify-email and reset-password.
  'INVALID_TOKEN',
  'TOKEN_EXPIRED',
  'USER_NOT_FOUND',
  'INVALID_USER',
  // Resending a verification link while signed in.
  'EMAIL_MISMATCH',
  'EMAIL_ALREADY_VERIFIED',
  // Signed-in actions: sessions, change-password, delete-user (and requirePasswordToDelete in ../auth.ts).
  'SESSION_NOT_FRESH',
  'SESSION_EXPIRED',
  'INVALID_PASSWORD',
  'CREDENTIAL_ACCOUNT_NOT_FOUND',
  'FAILED_TO_GET_SESSION',
] as const satisfies ReadonlyArray<keyof typeof BASE_ERROR_CODES>

/** An error code an exposed Better Auth endpoint answers with. */
export type AuthErrorCode = (typeof BETTER_AUTH_CODES)[number] | 'UNAUTHORIZED'

const KNOWN_CODES: ReadonlySet<string> = new Set<AuthErrorCode>([...BETTER_AUTH_CODES, 'UNAUTHORIZED'])
const isKnownCode = (code: string): code is AuthErrorCode => KNOWN_CODES.has(code)

/** What a Better Auth endpoint answered to callAuthEndpoint. */
export type AuthEndpointResult =
  | { readonly ok: true; readonly body: unknown }
  | {
      readonly ok: false
      readonly status: number
      /** Better Auth's error code (`INVALID_EMAIL_OR_PASSWORD`, ...), when the body carries a known one. */
      readonly code: AuthErrorCode | undefined
      /** Seconds until a rate-limited client may retry. */
      readonly retryAfter: number | undefined
    }

const codeOf = (body: unknown, path: string): AuthErrorCode | undefined => {
  const code =
    typeof body === 'object' && body !== null && 'code' in body && typeof body.code === 'string' ? body.code : undefined
  if (code === undefined || isKnownCode(code)) return code
  log('warn', 'unknown Better Auth error code', { path, code })
  return undefined
}

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

type EndpointInput = { readonly body?: Record<string, unknown>; readonly query?: Record<string, string> }

/** The request to Better Auth's router, sent as the client of the incoming request (its cookie and address). */
const endpointRequest = (method: 'GET' | 'POST', path: `/${string}`, input: EndpointInput): Request => {
  const url = new URL(`${AUTH_BASE_PATH}${path}`, env.appUrl)
  for (const [name, value] of Object.entries(input.query ?? {})) url.searchParams.set(name, value)
  const headers = withPeerAddress(new Headers(getRequestHeaders()))
  // The incoming request's body headers describe the server function call, not this one.
  for (const name of ['content-length', 'content-type', 'transfer-encoding']) headers.delete(name)
  if (input.body) headers.set('content-type', 'application/json')
  return new Request(url, { method, headers, ...(input.body ? { body: JSON.stringify(input.body) } : {}) })
}

/** Better Auth's answer, read into success or its status, error code and retry delay. */
const readOutcome = async (response: Response, path: string): Promise<AuthEndpointResult> => {
  const body = parseJson(await response.text())
  if (response.ok) return { ok: true, body }
  const retryAfter = Number(response.headers.get('x-retry-after'))
  return {
    ok: false,
    status: response.status,
    code: codeOf(body, path),
    retryAfter: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
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
  input: EndpointInput = {},
): Promise<AuthEndpointResult> => {
  const response = await dispatch(endpointRequest(method, path, input))
  const outgoing = getResponseHeaders()
  for (const cookie of response.headers.getSetCookie()) outgoing.append('set-cookie', cookie)
  return readOutcome(response, path)
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
