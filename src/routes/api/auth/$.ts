import { createFileRoute } from '@tanstack/react-router'
import { handleAuthRequest } from '#/server/http/auth-handler.ts'

// Better Auth owns its endpoints; they are intentionally outside the business OpenAPI contract. handleAuthRequest
// adds the TCP peer to X-Forwarded-For and hands the request to Better Auth, whose endpoint allowlist plugin
// (src/server/http/auth-endpoints.ts) answers 404 for every endpoint the app does not use.
export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: ({ request }) => handleAuthRequest(request),
      POST: ({ request }) => handleAuthRequest(request),
    },
  },
})
