// RequestValidation: how request decoding failures become the documented 400 ValidationError body.
// The typed client refuses to encode an invalid payload, so these requests go through webHandler (raw
// Requests into the same handlers). The integration suite only checks the tag against the running app;
// this pins the message and the issue paths (issues name the rule, never the rejected value), and the
// kinds that must not be mapped.
import { assert, describe, expect, it, onTestFinished } from '@effect/vitest'
import { Effect, Schema } from 'effect'
import { HttpApiError } from 'effect/unstable/httpapi'
import * as fc from 'fast-check'
import { ValidationError } from '#/contract/errors.ts'
import { POST_MAX_LENGTH, POSTS_PAGE_MAX } from '#/contract/limits.ts'
import { RequestValidation } from '#/contract/middleware.ts'
import { RequestValidationLive } from '#/server/api/middleware.ts'
import { webHandler } from './harness.ts'

const APP = 'http://localhost:3000'

const send = async (method: string, path: string, body?: string) => {
  const { handler, dispose } = webHandler()
  onTestFinished(dispose)
  const response = await handler(
    new Request(`${APP}${path}`, {
      method,
      headers: { cookie: 'better-auth.session_token=alice', 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body }),
    }),
  )
  return { status: response.status, json: (await response.json()) as unknown }
}

describe('payload validation', () => {
  const invalid: Array<[string, string, string]> = [
    // The contract's own messages (src/contract/post-input.ts), which the post forms show too.
    ['empty', JSON.stringify({ body: '' }), 'Write something to post.'],
    ['untrimmed', JSON.stringify({ body: ' hi ' }), 'Remove the spaces before and after the text.'],
    [
      'over the limit',
      JSON.stringify({ body: 'x'.repeat(POST_MAX_LENGTH + 1) }),
      `Use at most ${POST_MAX_LENGTH} characters.`,
    ],
    ['not a string', JSON.stringify({ body: 42 }), 'Expected string'],
    ['missing', JSON.stringify({}), 'Missing key'],
  ]

  it.each(invalid)('maps a %s body to ValidationError on create and update', async (_, body, message) => {
    for (const [method, path] of [
      ['POST', '/api/me/posts'],
      ['PATCH', '/api/me/posts/00000000-0000-4000-8000-000000000000'],
    ] as const) {
      const response = await send(method, path, body)
      expect(response, `${method} ${path}`).toEqual({
        status: 400,
        json: { _tag: 'ValidationError', message: 'Invalid request payload', issues: [{ path: ['body'], message }] },
      })
    }
  })

  it('maps malformed JSON to ValidationError without echoing the input', async () => {
    const response = await send('POST', '/api/me/posts', '{"body": "secret-value')
    expect(response.status).toBe(400)
    expect(response.json).toMatchObject({ _tag: 'ValidationError', message: 'Invalid request payload' })
    expect(JSON.stringify(response.json)).not.toContain('secret-value')
  })

  it('accepts a body of exactly the limit', async () => {
    const response = await send('POST', '/api/me/posts', JSON.stringify({ body: 'x'.repeat(POST_MAX_LENGTH) }))
    expect(response.status).toBe(201)
  })
})

/** Encodes a cursor key the way the server does: base64url JSON. */
const cursor = (key: unknown) => Buffer.from(JSON.stringify(key)).toString('base64url')

describe('list query validation', () => {
  const valid = { createdAt: '2026-01-01T00:00:01.000000Z', id: '00000000-0000-4000-8000-000000000000' }
  const invalid: Array<[string, string]> = [
    ['a cursor that is not base64url', `cursor=${encodeURIComponent('not base64!')}`],
    ['a cursor that is not JSON', `cursor=${Buffer.from('nope').toString('base64url')}`],
    ['a cursor without an id', `cursor=${cursor({ createdAt: valid.createdAt })}`],
    ['a cursor with a non-UUID id', `cursor=${cursor({ ...valid, id: 'post-1' })}`],
    ['a cursor at millisecond precision', `cursor=${cursor({ ...valid, createdAt: '2026-01-01T00:00:01.000Z' })}`],
    ['a cursor on February 30', `cursor=${cursor({ ...valid, createdAt: '2026-02-30T00:00:00.000000Z' })}`],
    // Postgres would read past the Z (`::timestamptz`) and fail the query: a 500 instead of a 400.
    ['a cursor with text after its Z', `cursor=${cursor({ ...valid, createdAt: `${valid.createdAt}junk` })}`],
    ['a limit of 0', 'limit=0'],
    ['a limit over the maximum', `limit=${POSTS_PAGE_MAX + 1}`],
    ['a limit in exponent notation', 'limit=1e1'],
    ['a limit that is not a number', 'limit=ten'],
  ]

  it.each(invalid)('maps %s to ValidationError on both lists', async (_, query) => {
    for (const path of ['/api/posts', '/api/me/posts']) {
      const response = await send('GET', `${path}?${query}`)
      expect(response, `${path}?${query}`).toMatchObject({
        status: 400,
        json: { _tag: 'ValidationError', message: 'Invalid request query' },
      })
      const { issues } = response.json as { issues: Array<{ path: unknown[] }> }
      expect(issues.map((issue) => issue.path[0])).toEqual([query.slice(0, query.indexOf('='))])
    }
  })

  it('answers any cursor with a page or a 400, never anything else', async () => {
    const { handler, dispose } = webHandler()
    onTestFinished(dispose)
    const cursors = fc.oneof(
      fc.string(),
      fc.jsonValue().map((value) => cursor(value)),
      fc.record({ createdAt: fc.string(), id: fc.oneof(fc.string(), fc.uuid()) }).map((value) => cursor(value)),
      fc.tuple(fc.string(), fc.uuid()).map(([suffix, id]) => cursor({ createdAt: `${valid.createdAt}${suffix}`, id })),
    )
    await fc.assert(
      fc.asyncProperty(cursors, async (value) => {
        for (const path of ['/api/posts', '/api/me/posts']) {
          const response = await handler(
            new Request(`${APP}${path}?cursor=${encodeURIComponent(value)}`, {
              headers: { cookie: 'better-auth.session_token=alice' },
            }),
          )
          const body = (await response.json()) as { _tag?: string }
          const outcome = response.status === 400 ? `400 ${body._tag}` : String(response.status)
          expect(['200', '400 ValidationError'], `${path} ${JSON.stringify(value)}`).toContain(outcome)
        }
      }),
      { numRuns: 300 },
    )
  })

  it('accepts a well-formed cursor that matches no post, and the largest limit', async () => {
    for (const path of ['/api/posts', '/api/me/posts']) {
      expect(await send('GET', `${path}?cursor=${cursor(valid)}&limit=${POSTS_PAGE_MAX}`)).toEqual({
        status: 200,
        json: { items: [], nextCursor: null },
      })
    }
  })
})

describe('RequestValidation middleware', () => {
  /** The middleware as a plain function: its declared types only admit what the router hands it. */
  type Middleware = (effect: Effect.Effect<never, unknown>, options: never) => Effect.Effect<unknown, unknown>
  const schemaError = Schema.decodeUnknownEffect(Schema.Struct({ id: Schema.String }))({ id: 1 }).pipe(Effect.flip)
  const run = (kind: HttpApiError.HttpApiSchemaError['kind']) =>
    Effect.gen(function* () {
      const middleware = (yield* RequestValidation) as unknown as Middleware
      const failure = new HttpApiError.HttpApiSchemaError({ kind, cause: yield* schemaError })
      // The options (endpoint, group) are not read by this middleware.
      return yield* middleware(Effect.fail(failure), undefined as never).pipe(Effect.flip)
    }).pipe(Effect.provide(RequestValidationLive))

  it.effect.each(['Params', 'Headers', 'Query', 'Payload'] as const)('maps %s decoding failures', (kind) =>
    Effect.gen(function* () {
      const error = yield* run(kind)
      assert.instanceOf(error, ValidationError)
      assert.deepStrictEqual(
        { message: error.message, issues: error.issues },
        { message: `Invalid request ${kind.toLowerCase()}`, issues: [{ path: ['id'], message: 'Expected string' }] },
      )
    }),
  )

  // A response that does not match its own schema is a server bug: it must reach ServerMiddleware
  // (src/server/api/web-handler.ts) unchanged and become a logged 500, never a 400 blaming the client.
  it.effect.each(['Body', 'ResponseHeaders'] as const)('passes %s encoding failures through', (kind) =>
    Effect.gen(function* () {
      const error = yield* run(kind)
      assert.isTrue(HttpApiError.HttpApiSchemaError.is(error))
    }),
  )
})
