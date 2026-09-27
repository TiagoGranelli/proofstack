// With the database down, no endpoint may pretend to work: each one fails with its documented error (a 503
// ServiceUnavailable for readiness, the empty 500 of an unexpected failure elsewhere), never an empty list or
// a success. A repository call whose DbError is swallowed (caught into a default value) fails here. The
// endpoints come from the contract, so a new one is checked without editing this file.
import { describe, expect, it, onTestFinished } from '@effect/vitest'
import { HttpApi } from 'effect/unstable/httpapi'
import { Api } from '#/contract/api.ts'
import { webHandler } from './harness.ts'

const APP = 'http://localhost:3000'
const MISSING_ID = '00000000-0000-4000-8000-000000000000'

interface Operation {
  readonly name: string
  readonly method: string
  readonly path: string
}
const operations: Operation[] = []
HttpApi.reflect(Api, {
  onGroup: () => {},
  onEndpoint: ({ group, endpoint }) =>
    operations.push({
      name: `${group.identifier}.${endpoint.identifier}`,
      method: endpoint.method,
      path: endpoint.path,
    }),
})

/** What each operation answers while every repository call fails. Liveness never touches the database. */
const EXPECTED: Record<string, { status: number; body: unknown }> = {
  'system.health': { status: 200, body: { status: 'ok' } },
  'system.ready': { status: 503, body: { _tag: 'ServiceUnavailable', message: 'Database unavailable' } },
  'publicPosts.list': { status: 500, body: '' },
  'myPosts.list': { status: 500, body: '' },
  'myPosts.create': { status: 500, body: '' },
  'myPosts.update': { status: 500, body: '' },
  'myPosts.remove': { status: 500, body: '' },
}

describe('with the database down', () => {
  it('knows every operation of the contract', () => {
    expect(operations.map((op) => op.name).toSorted()).toEqual(Object.keys(EXPECTED).toSorted())
  })

  it.each(operations)('$name fails with its documented error', async ({ name, method, path }) => {
    const { handler, dispose } = webHandler({ databaseDown: true })
    onTestFinished(dispose)
    const response = await handler(
      new Request(`${APP}${path.replace(':id', MISSING_ID)}`, {
        method,
        // A valid request from a signed-in author, so only the database can make it fail.
        headers: { cookie: 'better-auth.session_token=alice', 'content-type': 'application/json' },
        ...(method === 'POST' || method === 'PATCH' ? { body: JSON.stringify({ body: 'hello' }) } : {}),
      }),
    )
    const text = await response.text()
    expect({ status: response.status, body: text ? (JSON.parse(text) as unknown) : '' }).toEqual(EXPECTED[name])
  })
})
