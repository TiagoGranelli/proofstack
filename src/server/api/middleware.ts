import '@tanstack/react-start/server-only'
import { Effect, Layer, Redacted, SchemaIssue } from 'effect'
import { HttpServerRequest } from 'effect/unstable/http'
import { HttpApiError } from 'effect/unstable/httpapi'
import { Unauthorized, ValidationError } from '#/contract/errors.ts'
import { Authentication, CurrentUser, RequestValidation } from '#/contract/middleware.ts'
import { SessionLookup } from './session-lookup.ts'

/** The request's headers as web `Headers`, the form Better Auth reads a cookie from. */
const webHeaders = (incoming: Readonly<Record<string, unknown>>): Headers => {
  const headers = new Headers()
  for (const [key, value] of Object.entries(incoming)) if (typeof value === 'string') headers.set(key, value)
  return headers
}

const authenticationRequired = () => new Unauthorized({ message: 'Authentication required' })

/**
 * Resolves the session cookie into `CurrentUser`, or fails with 401.
 *
 * Effect tries each declared security scheme in turn with the cookie it names (empty when absent). Better Auth
 * itself picks the cookie name for the current APP_URL and verifies it, so both schemes share one implementation: a
 * request without the cookie fails without touching the database. During SSR the lookup is the one the route guard
 * already made for the same request (SessionLookup's live Layer in ./web-handler.ts).
 */
export const AuthenticationLive = Layer.effect(
  Authentication,
  Effect.gen(function* () {
    const sessions = yield* SessionLookup
    const authenticate: Authentication['Service']['sessionCookie'] = (httpEffect, { credential }) =>
      Effect.gen(function* () {
        if (Redacted.value(credential) === '') return yield* authenticationRequired()
        const request = yield* HttpServerRequest.HttpServerRequest
        const user = yield* sessions.userOf(webHeaders(request.headers))
        if (!user) return yield* authenticationRequired()
        return yield* Effect.provideService(httpEffect, CurrentUser, user)
      })
    return { sessionCookie: authenticate, secureSessionCookie: authenticate }
  }),
)

const formatIssues = SchemaIssue.makeFormatterStandardSchemaV1()
type FormattedIssue = ReturnType<typeof formatIssues>['issues'][number]

/**
 * Where a schema issue points, as path segments: `['body']` for a post's body. Only the path, never the value,
 * so neither a response nor a log line echoes what the client sent.
 */
export const issuePath = (issue: FormattedIssue): string[] =>
  issue.path?.map((segment) => String(typeof segment === 'object' ? segment.key : segment)) ?? []

/** Only request input. `Body` and `ResponseHeaders` mean the server produced an invalid response: a bug. */
const REQUEST_KINDS = new Set<HttpApiError.HttpApiSchemaError['kind']>(['Params', 'Headers', 'Query', 'Payload'])

/** A request decoding failure as the documented 400 body; any other error passes through unchanged. */
const toValidationError = <E>(error: E): E | ValidationError => {
  const failure: unknown = error
  if (!HttpApiError.HttpApiSchemaError.is(failure) || !REQUEST_KINDS.has(failure.kind)) return error
  const issues = formatIssues(failure.cause.issue).issues.map((issue) => ({
    path: issuePath(issue),
    message: issue.message,
  }))
  return new ValidationError({ message: `Invalid request ${failure.kind.toLowerCase()}`, issues })
}

/**
 * Turns request decoding failures into a `ValidationError` with each issue's path and rule. They arrive here as
 * typed failures before Effect's router renders them as an empty 400. Response encoding failures pass through;
 * ServerMiddleware (web-handler.ts) logs them as a 500.
 */
export const RequestValidationLive = Layer.succeed(RequestValidation, (httpEffect) =>
  httpEffect.pipe(Effect.mapError(toValidationError)),
)
