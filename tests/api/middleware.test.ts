// The API's shared middleware on an endpoint of its own, apart from any feature, so its coverage does not depend
// on the example: RequestValidation (request decoding failures become the documented 400 ValidationError) and
// WriteRateLimit (a write budget per user, 429 past it). A feature's own tests check that its endpoints use them.
import { assert, describe, expect, it, onTestFinished } from '@effect/vitest'
import { Effect, Layer, Schema } from 'effect'
import { HttpRouter, HttpServer } from 'effect/unstable/http'
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiError,
  HttpApiGroup,
  HttpApiSchema,
} from 'effect/unstable/httpapi'
import { ValidationError } from '#/contract/errors.ts'
import { WRITE_WINDOW_SECONDS, WRITES_PER_WINDOW } from '#/contract/limits.ts'
import { Authentication, RequestValidation, WriteRateLimit } from '#/contract/middleware.ts'
import { RequestValidationLive } from '#/server/api/middleware.ts'
import { WriteRateLimitLive } from '#/server/api/rate-limit.ts'
import { AuthenticationOverFakeSessions, memoryRateLimitStore } from './harness.ts'

/** A write endpoint that exists only here, wired like a feature's: session, then write limit, then validation. */
class Probe extends HttpApiGroup.make('probe')
  .add(
    HttpApiEndpoint.post('write', '/probe', {
      payload: Schema.Struct({ value: Schema.String.check(Schema.isMinLength(1)) }),
      success: HttpApiSchema.NoContent,
    })
      .middleware(RequestValidation)
      .middleware(WriteRateLimit),
  )
  .middleware(Authentication) {}
class ProbeApi extends HttpApi.make('probe').add(Probe) {}

const ProbeHandlers = HttpApiBuilder.group(ProbeApi, 'probe', (handlers) => handlers.handle('write', () => Effect.void))

/** The probe with the real middleware over a fresh in-memory rate-limit store. Not recorded for contract coverage. */
const probe = () => {
  const handlers = ProbeHandlers.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        AuthenticationOverFakeSessions,
        RequestValidationLive,
        WriteRateLimitLive.pipe(Layer.provide(memoryRateLimitStore)),
      ),
    ),
    Layer.merge(HttpServer.layerServices),
  )
  const web = HttpRouter.toWebHandler(HttpApiBuilder.layer(ProbeApi).pipe(Layer.provide(handlers)), {
    disableLogger: true,
  })
  onTestFinished(web.dispose)
  return async (session: string | undefined, body: string) => {
    const response = await web.handler(
      new Request('http://localhost:3000/probe', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(session ? { cookie: `better-auth.session_token=${session}` } : {}),
        },
        body,
      }),
    )
    const text = await response.text()
    return { status: response.status, json: text ? (JSON.parse(text) as unknown) : undefined }
  }
}

const valid = JSON.stringify({ value: 'x' })

describe('RequestValidation on an endpoint', () => {
  it('answers an invalid payload with the rule it broke, never the value', async () => {
    const send = probe()
    expect(await send('alice', JSON.stringify({ value: '' }))).toEqual({
      status: 400,
      json: {
        _tag: 'ValidationError',
        message: 'Invalid request payload',
        issues: [{ path: ['value'], message: 'Expected a value with a length of at least 1' }],
      },
    })
    const malformed = await send('alice', '{"value": "secret-value')
    expect(malformed).toMatchObject({
      status: 400,
      json: { _tag: 'ValidationError', message: 'Invalid request payload' },
    })
    expect(JSON.stringify(malformed.json)).not.toContain('secret-value')
  })

  it('runs after Authentication: without a session the answer is 401 whatever the body', async () => {
    const send = probe()
    for (const body of [valid, '{'])
      expect(await send(undefined, body)).toEqual({
        status: 401,
        json: { _tag: 'Unauthorized', message: 'Authentication required' },
      })
  })
})

describe('WriteRateLimit on an endpoint', () => {
  it('admits the limit per user, then answers 429 with the computed wait, before reading the body', async () => {
    const send = probe()
    for (let i = 0; i < WRITES_PER_WINDOW; i++) expect((await send('alice', valid)).status).toBe(204)
    // Counted before the body is decoded, so an invalid body is refused the same way.
    for (const [index, body] of [valid, '{', JSON.stringify({ value: '' })].entries()) {
      expect(await send('alice', body)).toEqual({
        status: 429,
        // The wait the store computed on the harness's clock (one second per request), not the whole window.
        json: {
          _tag: 'RateLimited',
          message: 'Too many changes in a short time',
          retryAfter: WRITE_WINDOW_SECONDS - 1 - index,
        },
      })
    }
    expect((await send('bob', valid)).status).toBe(204)
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
