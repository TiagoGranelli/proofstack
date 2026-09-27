import { createCsrfMiddleware, createMiddleware, createStart } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'
import { serverFunctionErrors } from '#/lib/server-function-errors.ts'

// Security headers, the Content-Security-Policy and request logging live in the Nitro plugin
// src/server/nitro/http.ts, which also sees static files that never reach this middleware. Neither
// sets Cache-Control on pages: each route decides (see docs/operations.md, Caching).

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
/** Largest accepted request body. Posts are 280 characters; auth payloads are a few hundred bytes. */
const MAX_BODY_BYTES = 64 * 1024

// Every state-changing request (server functions, /api/*, /api/auth/*) must come from our own origin:
// Sec-Fetch-Site must be same-origin when present, otherwise Origin (or Referer) must equal APP_URL.
// Requests with none of the three are rejected. Defining src/start.ts disables Start's implicit
// server-function CSRF check, so this replaces it.
const csrf = createCsrfMiddleware({
  filter: ({ request }) => !SAFE_METHODS.has(request.method),
  origin: (value) => value === new URL(process.env.APP_URL ?? 'http://localhost:3000').origin,
})

// Nothing downstream limits body size (srvx and Better Auth read whole bodies into memory).
// 413 for a declared oversize body, 411 for a body without Content-Length (chunked upload).
const bodyLimit = createMiddleware().server(({ request, next }) => {
  if (SAFE_METHODS.has(request.method)) return next()
  const length = request.headers.get('content-length')
  if (length === null) return request.headers.has('transfer-encoding') ? new Response(null, { status: 411 }) : next()
  if (!/^\d+$/.test(length)) return new Response(null, { status: 400 })
  if (Number(length) > MAX_BODY_BYTES) return new Response(null, { status: 413 })
  return next()
})

// Per-request CSP nonce. src/router.tsx hands it to the router (`ssr.nonce`), which stamps it on the
// scripts it renders; the Nitro plugin reads this header, builds the CSP from it and removes it.
// Off in dev (Vite injects its own inline scripts) and while Nitro prerenders static pages.
const cspNonce = createMiddleware().server(({ request, next }) => {
  const enabled = process.env.NODE_ENV === 'production' && !request.headers.has('x-nitro-prerender')
  const nonce: string | undefined = enabled ? crypto.randomUUID().replaceAll('-', '') : undefined
  if (nonce) setResponseHeader('x-proofstack-csp-nonce', nonce)
  return next({ context: { cspNonce: nonce } })
})

// Start looks server functions up by the id in /_serverFn/<id> and throws a plain Error for an unknown
// id, which it would answer with a 500 and an error log. An unknown id is a client error: answer 404.
// Start exposes no typed error for this, so the message is matched: the production resolver says "Server
// function info not found for <id>" (or "Server function not accessible from client: <id>" for a
// server-only function), the dev server "Invalid server function ID: <id>". If the wording changes, the
// fallback is the old 500, and tests/integration/security.test.ts fails for the production build.
// Everything else is rethrown untouched.
const UNKNOWN_SERVER_FN =
  /^(?:Server function info not found for |Server function not accessible from client: |Invalid server function ID: )/
const serverFnNotFound = createMiddleware().server(async ({ handlerType, next }) => {
  if (handlerType !== 'serverFn') return next()
  try {
    return await next()
  } catch (error) {
    if (error instanceof Error && UNKNOWN_SERVER_FN.test(error.message)) return new Response(null, { status: 404 })
    throw error
  }
})

export const startInstance = createStart(() => ({
  requestMiddleware: [serverFnNotFound, csrf, bodyLimit, cspNonce],
  functionMiddleware: [serverFunctionErrors],
}))
