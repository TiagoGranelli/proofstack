import '@tanstack/react-start/server-only'
import { Cause, Effect, Layer, SchemaIssue } from 'effect'
import { HttpRouter, HttpServer, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http'
import { HttpApiBuilder, HttpApiError } from 'effect/unstable/httpapi'
import { Api } from '#/contract/api.ts'
import { Database } from '../db/client.ts'
import { DatabaseHealth } from '../db/health.ts'
import { requestSession } from '../http/request-session.ts'
import { onShutdown } from '../lifecycle.ts'
import { log } from '../log.ts'
import { PostsRepo } from '../posts/repo.ts'
import { ApiHandlers } from './handlers.ts'
import { AuthenticationLive, issuePath, RequestValidationLive } from './middleware.ts'
import { RateLimitStore, WriteRateLimitLive } from './rate-limit.ts'
import { SessionLookup } from './session-lookup.ts'

const formatIssues = SchemaIssue.makeFormatterStandardSchemaV1()

/** A response that fails its own schema is logged by kind and field paths, never by value. */
const describeDefect = (defect: unknown): unknown => {
  if (!HttpApiError.HttpApiSchemaError.is(defect)) return defect
  const paths = formatIssues(defect.cause.issue).issues.map((issue) => issuePath(issue).join('.'))
  return Object.assign(
    new Error(`Response ${defect.kind.toLowerCase()} does not match its schema at: ${paths.join(', ')}`),
    {
      name: 'ResponseSchemaError',
    },
  )
}

// Defects (bugs, unreachable database, a response that does not match its schema) become an empty
// 500 for the client; the cause goes to the log. Without this, Effect renders some defects by
// themselves: a response that fails to encode would reach the client as an empty 400.
// Responses default to no-store: /api/me/* is per-user and must never be kept by shared caches.
const ServerMiddleware = HttpRouter.middleware(
  (httpEffect) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      return yield* httpEffect.pipe(
        Effect.catchCause((cause) => {
          if (!Cause.hasDies(cause)) return Effect.failCause(cause)
          log('error', 'api defect', {
            method: request.method,
            path: request.url.split('?')[0],
            error: describeDefect(Cause.squash(cause)),
          })
          return Effect.succeed(HttpServerResponse.empty({ status: 500 }))
        }),
        Effect.map((response) =>
          response.headers['cache-control']
            ? response
            : HttpServerResponse.setHeader(response, 'cache-control', 'no-store'),
        ),
      )
    }),
  { global: true },
)

// Better Auth's session of the request's cookie, looked up once per incoming request (requestSession). Only the
// fields CurrentUser declares reach the handlers.
const SessionLookupLive = Layer.succeed(SessionLookup, {
  userOf: (headers) =>
    Effect.tryPromise(() => requestSession(headers)).pipe(
      Effect.orDie,
      Effect.map((session) =>
        session ? { id: session.user.id, name: session.user.name, email: session.user.email } : null,
      ),
    ),
})

const ApiLive = HttpApiBuilder.layer(Api, { openapiPath: '/api/openapi.json' }).pipe(
  Layer.provide(ApiHandlers),
  Layer.provide([
    // The services the handlers read, each over the app's Postgres pool.
    Layer.mergeAll(DatabaseHealth.layer, PostsRepo.layer).pipe(Layer.provide(Database.layer)),
    AuthenticationLive.pipe(Layer.provide(SessionLookupLive)),
    RequestValidationLive,
    WriteRateLimitLive.pipe(Layer.provide(RateLimitStore.postgres)),
  ]),
  Layer.merge(ServerMiddleware),
)

// Logging goes through ../log.ts only (sanitized JSON lines). Effect's logger stays at its default and
// is not used: the router's request logger is disabled because the Nitro plugin
// src/server/nitro/http.ts logs every request once, and defects are logged by ServerMiddleware above.
const { handler, dispose } = HttpRouter.toWebHandler(ApiLive.pipe(Layer.provide(HttpServer.layerServices)), {
  disableLogger: true,
})
onShutdown('effect-api', dispose)

/** Web-standard `(Request) => Promise<Response>` for every `/api/*` route except `/api/auth/*`. */
export const apiHandler = handler
