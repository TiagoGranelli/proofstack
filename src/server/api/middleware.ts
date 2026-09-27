import '@tanstack/react-start/server-only'
import { Effect, Layer, Redacted, SchemaIssue } from 'effect'
import { HttpServerRequest } from 'effect/unstable/http'
import { HttpApiError } from 'effect/unstable/httpapi'
import { Unauthorized, ValidationError } from '#/contract/errors.ts'
import { Authentication, CurrentUser, RequestValidation } from '#/contract/middleware.ts'
import { requestSession } from '../http/request-session.ts'

// Effect tries each declared security scheme in turn with the cookie it names (empty when absent).
// Better Auth itself picks the cookie name for the current APP_URL and verifies it, so both schemes
// share one implementation: a request without the cookie fails without touching the database. During SSR the
// lookup is the one the route guard already made for the same request (requestSession).
const authenticate: Authentication['Service']['sessionCookie'] = (httpEffect, { credential }) =>
  Effect.gen(function* () {
    if (Redacted.value(credential) === '') return yield* new Unauthorized({ message: 'Authentication required' })
    const request = yield* HttpServerRequest.HttpServerRequest
    const headers = new Headers()
    for (const [key, value] of Object.entries(request.headers)) if (typeof value === 'string') headers.set(key, value)
    const session = yield* Effect.tryPromise(() => requestSession(headers)).pipe(Effect.orDie)
    if (!session) return yield* new Unauthorized({ message: 'Authentication required' })
    const { id, name, email } = session.user
    return yield* Effect.provideService(httpEffect, CurrentUser, { id, name, email })
  })

export const AuthenticationLive = Layer.succeed(Authentication, {
  sessionCookie: authenticate,
  secureSessionCookie: authenticate,
})

const formatIssues = SchemaIssue.makeFormatterStandardSchemaV1()

/** Only request input. `Body` and `ResponseHeaders` mean the server produced an invalid response: a bug. */
const REQUEST_KINDS = new Set<HttpApiError.HttpApiSchemaError['kind']>(['Params', 'Headers', 'Query', 'Payload'])

export const RequestValidationLive = Layer.succeed(RequestValidation, (httpEffect) =>
  httpEffect.pipe(
    // Decoding failures arrive here as typed failures before Effect's router renders them as an empty 400.
    // Response encoding failures pass through; ServerMiddleware (web-handler.ts) logs them as a 500.
    Effect.mapError((error) => {
      const failure: unknown = error
      if (!HttpApiError.HttpApiSchemaError.is(failure) || !REQUEST_KINDS.has(failure.kind)) return error
      const issues = formatIssues(failure.cause.issue).issues.map((issue) => ({
        path: issue.path?.map((segment) => String(typeof segment === 'object' ? segment.key : segment)) ?? [],
        message: issue.message,
      }))
      return new ValidationError({ message: `Invalid request ${failure.kind.toLowerCase()}`, issues })
    }),
  ),
)
