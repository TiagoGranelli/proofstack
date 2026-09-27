import { definePlugin } from 'nitro'
import { env } from '../env.ts'
import { log } from '../log.ts'

const https = env.appUrl.startsWith('https://')

const baselineHeaders = Object.entries({
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  ...(https ? { 'strict-transport-security': 'max-age=63072000; includeSubDomains' } : {}),
})

/**
 * Content-Security-Policy for responses that bring none: JSON, public/ files, Nitro's own error responses.
 * They are not documents that load anything, so the policy forbids everything. HTML documents carry their
 * own policy without 'unsafe-inline' (src/lib/content-security-policy.ts): a per-request nonce for SSR
 * pages, set by the root route, and sha256 hashes for prerendered pages, set by the route rule that the
 * prerender hook in vite.config.ts writes.
 */
const LOCKED_DOWN_CSP = "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

const QUIET = /^\/(api\/(health|ready)$|assets\/|favicon)/
const started = new WeakMap<object, number>()

// Runs for every response Nitro sends: SSR pages, API and auth routes, server functions, and also
// public/ files and prerendered pages, which never reach the TanStack Start request middleware.
export default definePlugin((nitroApp) => {
  const production = process.env.NODE_ENV === 'production'

  nitroApp.hooks.hook('request', (event) => {
    started.set(event, performance.now())
  })

  nitroApp.hooks.hook('response', (response, event) => {
    if (production) {
      for (const [name, value] of baselineHeaders) if (!response.headers.has(name)) response.headers.set(name, value)
      const csp = response.headers.get('content-security-policy')
      if (!csp) response.headers.set('content-security-policy', LOCKED_DOWN_CSP)
      else if (https) response.headers.set('content-security-policy', `${csp}; upgrade-insecure-requests`)
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
