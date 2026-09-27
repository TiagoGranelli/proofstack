import { createFileRoute } from '@tanstack/react-router'
import { apiHandler } from '#/server/api/web-handler.ts'

// All business operations: the Effect HttpApi described by src/contract/api.ts and openapi.json.
// /api/auth/* is more specific and is matched by ./auth/$.ts first.
export const Route = createFileRoute('/api/$')({
  server: { handlers: { ANY: ({ request }) => apiHandler(request) } },
})
