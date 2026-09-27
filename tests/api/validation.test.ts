// RequestValidation: how request decoding failures become the documented 400 ValidationError body.
// The typed client refuses to encode an invalid payload, so these requests go through webHandler (raw
// Requests into the same handlers). The integration suite only checks the tag against the running app;
// this pins the message and the issue paths (issues name the rule, never the rejected value), and the
// kinds that must not be mapped.
import { assert, describe, expect, it, onTestFinished } from '@effect/vitest'
import { Effect, Schema } from 'effect'
import { HttpApiError } from 'effect/unstable/httpapi'
import { ValidationError } from '#/contract/errors.ts'
import { POST_MAX_LENGTH } from '#/contract/limits.ts'
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
    ['empty', JSON.stringify({ body: '' }), 'Expected a value with a length of at least 1'],
    ['untrimmed', JSON.stringify({ body: ' hi ' }), 'Expected a string with no leading or trailing whitespace'],
    [
      'over the limit',
      JSON.stringify({ body: 'x'.repeat(POST_MAX_LENGTH + 1) }),
      `Expected a value with a length of at most ${POST_MAX_LENGTH}`,
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
