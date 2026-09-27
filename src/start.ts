import { createCsrfMiddleware, createMiddleware, createStart } from '@tanstack/react-start'
import { appOrigin } from '#/lib/app-origin.ts'
import { serverFunctionErrors } from '#/lib/server-function-errors.ts'

// Security headers and request logging live in the Nitro plugin src/server/nitro/http.ts, which also sees
// static files that never reach this middleware. The Content-Security-Policy of SSR pages comes from the
// root route (src/routes/__root.tsx). Neither sets Cache-Control on pages: each route decides (see
// docs/operations.md, Caching).

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
/** Largest accepted request body. API and auth payloads are a few hundred bytes. */
const MAX_BODY_BYTES = 64 * 1024

// Every state-changing request (server functions, /api/*, /api/auth/*) must come from our own origin:
// Sec-Fetch-Site must be same-origin when present, otherwise Origin (or Referer) must equal APP_URL, as
// validated at startup (src/lib/app-origin.ts).
// Requests with none of the three are rejected. Defining src/start.ts disables Start's implicit
// server-function CSRF check, so this replaces it.
const csrf = createCsrfMiddleware({
  filter: ({ request }) => !SAFE_METHODS.has(request.method),
  origin: (value) => value === appOrigin(),
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

export const startInstance = createStart(() => ({
  requestMiddleware: [csrf, bodyLimit],
  functionMiddleware: [serverFunctionErrors],
}))
