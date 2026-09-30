// With the database down, no endpoint may pretend to work: each one fails with its documented error, never an empty
// list or a success. A repository call whose DbError is swallowed (caught into a default value) fails here. The
// operations and what they declare come from the contract (./operations.ts), so a new endpoint is checked without
// editing this file; only one that does not reach the database is listed in NO_DATABASE.
import { describe, expect, it, onTestFinished } from '@effect/vitest'
import { authors, webHandler } from './harness.ts'
import { operations, requestFor } from './operations.ts'

/**
 * What an operation answers while every repository call fails: the 503 ServiceUnavailable it declares for an outage
 * (readiness), or else the empty 500 of an unexpected failure.
 */
const expectedFor = (errorStatuses: ReadonlySet<number>) =>
  errorStatuses.has(503)
    ? { status: 503, body: { _tag: 'ServiceUnavailable', message: 'Database unavailable' } }
    : { status: 500, body: '' }

/**
 * Operations that answer without the database. Liveness never touches it, and neither does `me.get` here, where the
 * session check is faked (the real one reads the session from Postgres: tests/integration/db-failure.test.ts).
 */
const NO_DATABASE: Record<string, { status: number; body: unknown }> = {
  'system.health': { status: 200, body: { status: 'ok' } },
  'me.get': { status: 200, body: authors.alice },
}

describe('with the database down', () => {
  it('lists in NO_DATABASE only operations the contract has', () => {
    const names = new Set(operations.map((op) => op.name))
    expect(Object.keys(NO_DATABASE).filter((name) => !names.has(name))).toEqual([])
  })

  it.each(operations)('$name fails with its documented error', async (operation) => {
    const { handler, dispose } = webHandler({ databaseDown: true })
    onTestFinished(dispose)
    // A valid request from a signed-in author, so only the database can make it fail.
    const response = await handler(requestFor(operation, { cookie: 'better-auth.session_token=alice' }))
    const text = await response.text()
    expect({ status: response.status, body: text ? (JSON.parse(text) as unknown) : '' }).toEqual(
      NO_DATABASE[operation.name] ?? expectedFor(operation.errorStatuses),
    )
  })
})
