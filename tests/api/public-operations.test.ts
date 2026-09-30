// Every operation needs a session unless it is listed in PUBLIC_OPERATIONS. The operations come from the contract
// (./operations.ts), so a new endpoint whose group is not behind the `Authentication` middleware fails here without
// edits.
import { describe, expect, it, onTestFinished } from '@effect/vitest'
import { webHandler } from './harness.ts'
import { operations, requestFor } from './operations.ts'

/** Operations anyone may call without a session. A new public endpoint is a deliberate, reviewed edit here. */
const PUBLIC_OPERATIONS = new Set(['GET /api/health', 'GET /api/ready', 'GET /api/posts'])

const keyOf = (operation: { method: string; path: string }) => `${operation.method} ${operation.path}`
const keyed = operations.map((operation) => ({ key: keyOf(operation), operation }))

describe('without a session', () => {
  it('lists only operations the contract has', () => {
    const known = new Set(keyed.map(({ key }) => key))
    expect([...PUBLIC_OPERATIONS].filter((key) => !known.has(key))).toEqual([])
  })

  it.each(keyed.filter(({ key }) => !PUBLIC_OPERATIONS.has(key)))(
    '$key answers 401 (behind the Authentication middleware; if it is public by design, add it to PUBLIC_OPERATIONS)',
    async ({ operation }) => {
      const { handler, dispose } = webHandler()
      onTestFinished(dispose)
      // A valid request, so only the missing session can make it fail.
      const response = await handler(requestFor(operation))
      expect(response.status).toBe(401)
    },
  )
})
