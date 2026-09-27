import '@tanstack/react-start/server-only'
import { getRequestIP } from '@tanstack/react-start/server'
import { auth } from '../auth.ts'
import { env } from '../env.ts'
import { log } from '../log.ts'
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

/** Handles /api/auth/* for the Start route in src/routes/api/auth/$.ts. */
export const handleAuthRequest = (request: Request): Promise<Response> => {
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
  // A fresh Request: the incoming one is srvx's Node request wrapper, whose headers cannot be replaced.
  return dispatch(
    new Request(request.url, {
      method: request.method,
      headers: withPeerAddress(request.headers),
      signal: request.signal,
      ...(hasBody ? { body: request.body, duplex: 'half' } : {}),
    }),
  )
}
