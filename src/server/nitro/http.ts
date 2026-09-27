import { definePlugin } from 'nitro'
import { env } from '../env.ts'
import { isDraining } from '../lifecycle.ts'
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
/**
 * Status logged for a request whose client disconnected before the response (nginx's "client closed request").
 * Its response still settles, usually as a 500 from the aborted body or render, but nobody receives it. Logged as
 * that 500 at `error`, the end of every load test and every impatient client tripped 5xx alerts.
 */
const CLIENT_CLOSED = 499

type Event = { req: Request }

/** The production security headers, where the response does not set its own. */
const addSecurityHeaders = (headers: Headers) => {
  for (const [name, value] of baselineHeaders) if (!headers.has(name)) headers.set(name, value)
  const csp = headers.get('content-security-policy')
  if (!csp) headers.set('content-security-policy', LOCKED_DOWN_CSP)
  else if (https) headers.set('content-security-policy', `${csp}; upgrade-insecure-requests`)
}

/** One JSON line per request. Never the query string, headers or body: they can carry credentials. */
const logRequest = (response: Response, event: Event) => {
  const path = new URL(event.req.url).pathname
  const aborted = event.req.signal.aborted
  const status = aborted ? CLIENT_CLOSED : response.status
  if (QUIET.test(path) && status < 400) return
  const since = started.get(event)
  log(status >= 500 ? 'error' : 'info', 'request', {
    method: event.req.method,
    path,
    status,
    ...(aborted ? { aborted: true } : {}),
    ms: since === undefined ? undefined : Math.round(performance.now() - since),
  })
}

// Runs for every response Nitro sends: SSR pages, API and auth routes, server functions, and also
// public/ files and prerendered pages, which never reach the TanStack Start request middleware.
export default definePlugin((nitroApp) => {
  const production = process.env.NODE_ENV === 'production'

  nitroApp.hooks.hook('request', (event) => {
    started.set(event, performance.now())
    // srvx creates the request's abort signal on first access and aborts it when the client disconnects;
    // touching it here arms it, so the response hook can tell an abandoned request from a failed one.
    void event.req.signal
  })

  nitroApp.hooks.hook('response', (response, event) => {
    // Once draining, every response closes its connection: a keep-alive client (a load balancer) then opens a
    // new one, which the closed listener refuses, instead of sending more requests to a stopping process.
    if (isDraining()) response.headers.set('connection', 'close')
    if (production) addSecurityHeaders(response.headers)
    logRequest(response, event)
  })
})
