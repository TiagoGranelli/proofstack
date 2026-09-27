// Every operation needs a session unless it is listed in PUBLIC_OPERATIONS. The operations come from the contract,
// so a new endpoint whose group is not behind the `Authentication` middleware fails here without edits.
import { describe, expect, it, onTestFinished } from '@effect/vitest'
import { HttpApi } from 'effect/unstable/httpapi'
import { Api } from '#/contract/api.ts'
import { webHandler } from './harness.ts'

/** Operations anyone may call without a session. A new public endpoint is a deliberate, reviewed edit here. */
const PUBLIC_OPERATIONS = new Set(['GET /api/health', 'GET /api/ready', 'GET /api/posts'])

const MISSING_ID = '00000000-0000-4000-8000-000000000000'
const operations: { key: string; method: string; path: string }[] = []
HttpApi.reflect(Api, {
  onGroup: () => {},
  onEndpoint: ({ endpoint: { method, path } }) => operations.push({ key: `${method} ${path}`, method, path }),
})
const known = new Set(operations.map(({ key }) => key))

describe('without a session', () => {
  it('lists only operations the contract has', () => {
    expect([...PUBLIC_OPERATIONS].filter((key) => !known.has(key))).toEqual([])
  })

  it.each(operations.filter(({ key }) => !PUBLIC_OPERATIONS.has(key)))(
    '$key answers 401 (behind the Authentication middleware; if it is public by design, add it to PUBLIC_OPERATIONS)',
    async ({ method, path }) => {
      const { handler, dispose } = webHandler()
      onTestFinished(dispose)
      const response = await handler(
        new Request(`http://localhost:3000${path.replace(':id', MISSING_ID)}`, {
          method,
          headers: { 'content-type': 'application/json' },
          // A valid payload, so only the missing session can make it fail.
          ...(method === 'POST' || method === 'PATCH' ? { body: JSON.stringify({ body: 'hello' }) } : {}),
        }),
      )
      expect(response.status).toBe(401)
    },
  )
})
