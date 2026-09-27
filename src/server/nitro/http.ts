import { definePlugin } from 'nitro'
import { env } from '../env.ts'
import { log } from '../log.ts'

/** Set by the request middleware in src/start.ts; turned into the CSP here and never sent to clients. */
const NONCE_HEADER = 'x-proofstack-csp-nonce'

const baselineHeaders = Object.entries({
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  ...(env.appUrl.startsWith('https://') ? { 'strict-transport-security': 'max-age=63072000; includeSubDomains' } : {}),
})

/**
 * Content-Security-Policy.
 * - SSR responses use a per-request nonce: TanStack Router stamps it on every script and preload it
 *   renders (router `ssr.nonce`, see src/router.tsx), so no other inline script can run.
 * - Everything else (Nitro-prerendered pages, public/ files, JSON) gets the fallback. Prerendered
 *   HTML cannot carry a per-request nonce, so its inline hydration scripts need 'unsafe-inline';
 *   those pages have no request-dependent content that could inject markup.
 * - Styles allow 'unsafe-inline': Start inlines route CSS and React renders `style` attributes
 *   (e.g. the default error component). CSS injection does not execute script.
 */
const contentSecurityPolicy = (nonce: string | null) =>
  [
    "default-src 'self'",
    nonce ? `script-src 'self' 'nonce-${nonce}'` : "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(env.appUrl.startsWith('https://') ? ['upgrade-insecure-requests'] : []),
  ].join('; ')

const QUIET = /^\/(api\/(health|ready)$|assets\/|favicon)/
const started = new WeakMap<object, number>()

// Runs for every response Nitro sends: SSR pages, API and auth routes, server functions, and also
// public/ files and prerendered pages, which never reach the TanStack Start request middleware.
export default definePlugin((nitroApp) => {
  const production = process.env.NODE_ENV === 'production'
  const fallbackCsp = contentSecurityPolicy(null)

  nitroApp.hooks.hook('request', (event) => {
    started.set(event, performance.now())
  })

  nitroApp.hooks.hook('response', (response, event) => {
    const nonce = response.headers.get(NONCE_HEADER)
    response.headers.delete(NONCE_HEADER)
    if (production) {
      for (const [name, value] of baselineHeaders) if (!response.headers.has(name)) response.headers.set(name, value)
      response.headers.set('content-security-policy', nonce ? contentSecurityPolicy(nonce) : fallbackCsp)
    }

    // One JSON line per request. Never the query string, headers or body: they can carry credentials.
    const path = new URL(event.req.url).pathname
    const status = response.status
    if (QUIET.test(path) && status < 400) return
    const since = started.get(event)
    log(status >= 500 ? 'error' : 'info', 'request', {
      method: event.req.method,
      path,
      status,
      ms: since === undefined ? undefined : Math.round(performance.now() - since),
    })
  })
})
