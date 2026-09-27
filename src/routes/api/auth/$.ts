import { createFileRoute } from '@tanstack/react-router'
import { handleAuthRequest } from '#/server/http/auth-handler.ts'

// Better Auth owns its endpoints; they are intentionally outside the business OpenAPI contract.
// handleAuthRequest exposes only an allowlist of them and pins the client IP used for rate limiting.
export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: ({ request }) => handleAuthRequest(request),
      POST: ({ request }) => handleAuthRequest(request),
    },
  },
})
