// In-memory harness for the Effect handlers: the real contract, handlers and middleware (Authentication,
// RequestValidation, WriteRateLimit), with the repositories, the rate-limit counters and the session store kept in
// memory. No database, no Better Auth call, no HTTP server: the typed client's requests go through the same
// encoding, routing, middleware and decoding as the running API.
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { Effect, Layer } from 'effect'
import {
  HttpClient,
  HttpClientRequest,
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from 'effect/unstable/http'
import { HttpApiBuilder, HttpApiClient, HttpApiMiddleware } from 'effect/unstable/httpapi'
import { Api } from '#/contract/api.ts'
import { Authentication } from '#/contract/middleware.ts'
import { MeHandlers, MyPostsHandlers, PublicPostsHandlers, SystemHandlers } from '#/server/api/handlers.ts'
import { AuthenticationLive, RequestValidationLive } from '#/server/api/middleware.ts'
import { RateLimitStore, WriteRateLimitLive } from '#/server/api/rate-limit.ts'
import { SessionLookup } from '#/server/api/session-lookup.ts'
import { DatabaseHealth } from '#/server/db/health.ts'
import { memoryQuery, type RepoOptions } from './memory-db.ts'
import { memoryPostsRepo } from './posts-repo.ts'

/** The authors the fake session store knows, keyed by session token. */
export const authors = {
  alice: { id: 'user-alice', name: 'Alice', email: 'alice@example.test' },
  bob: { id: 'user-bob', name: 'Bob', email: 'bob@example.test' },
} as const
type AuthorName = keyof typeof authors

const memoryDatabaseHealth = (options: RepoOptions) =>
  Layer.succeed(DatabaseHealth, { ping: memoryQuery(options)(() => undefined) })

/** The token of a request's Better Auth session cookie (under either of its names), if it sends one. */
const sessionToken = (headers: Headers) =>
  /(?:^|;\s*)(?:__Secure-)?better-auth\.session_token=([^;]*)/.exec(headers.get('cookie') ?? '')?.[1]

/** The session store in place of Better Auth: a session token that is an author's key in `authors` is theirs. */
export const FakeSessionLookup = Layer.succeed(SessionLookup, {
  userOf: (headers) =>
    Effect.sync(() => {
      const token = sessionToken(headers)
      return token !== undefined && Object.hasOwn(authors, token) ? authors[token as AuthorName] : null
    }),
})

/** The real Authentication middleware over the fake session store: an unknown or missing session is a 401. */
export const AuthenticationOverFakeSessions: Layer.Layer<Authentication> = AuthenticationLive.pipe(
  Layer.provide(FakeSessionLookup),
)

/**
 * RateLimitStore in memory, per layer, with the rule of the Postgres store (src/server/auth-rate-limit.ts) on a
 * virtual clock where every request takes one second: a window starts at the first request and restarts once
 * `window` seconds passed since the last admitted one, and a refused request waits for the rest of it. So
 * after `max` admitted requests in a row, the next ones are told to wait `window - 1`, `window - 2`, ... seconds.
 */
export const memoryRateLimitStore = Layer.sync(RateLimitStore, () => {
  const buckets = new Map<string, { count: number; lastRequest: number }>()
  let now = 0
  return {
    consume: (key, rule) =>
      Effect.sync(() => {
        now += 1000
        const windowMs = rule.window * 1000
        const bucket = buckets.get(key)
        const expired = !bucket || bucket.lastRequest <= now - windowMs
        const count = expired ? 1 : bucket.count + 1
        const lastRequest = expired || bucket.count < rule.max ? now : bucket.lastRequest
        buckets.set(key, { count, lastRequest })
        if (count <= rule.max) return { allowed: true, retryAfter: null }
        return { allowed: false, retryAfter: Math.max(1, Math.ceil((lastRequest + windowMs - now) / 1000)) }
      }),
  }
})

/**
 * The handlers under test, over a fresh in-memory repository and rate-limit store (provide it per test for
 * isolation).
 * Middleware is provided with `provideMerge` because the HTTP pipeline also resolves it when the routes
 * are built.
 */
export const apiLayer = (options: RepoOptions = {}) =>
  Layer.mergeAll(SystemHandlers, MeHandlers, PublicPostsHandlers, MyPostsHandlers).pipe(
    Layer.provide(memoryDatabaseHealth(options)),
    Layer.provide(memoryPostsRepo(options)),
    Layer.provideMerge(
      Layer.mergeAll(
        AuthenticationOverFakeSessions,
        RequestValidationLive,
        WriteRateLimitLive.pipe(Layer.provide(memoryRateLimitStore)),
      ),
    ),
    Layer.merge(HttpServer.layerServices),
  )

/**
 * The same handlers as a web-standard `(Request) => Promise<Response>`, built like
 * src/server/api/web-handler.ts, for input the typed client refuses to encode (it validates payloads
 * before sending them). Call `dispose` when done.
 */
export const webHandler = (options: RepoOptions = {}) => {
  const web = HttpRouter.toWebHandler(HttpApiBuilder.layer(Api).pipe(Layer.provide(apiLayer(options))), {
    disableLogger: true,
  })
  return {
    handler: async (request: Request) => {
      const response = await web.handler(request)
      observe(request.method, request.url, response.status)
      return response
    },
    dispose: web.dispose,
  }
}

/**
 * Client-side middleware that sends a Better Auth session cookie: an author's (signed in), an unknown
 * token (a forged or expired session) or none at all.
 */
const session = (token: Session) =>
  HttpApiMiddleware.layerClient(Authentication, ({ next, request }) =>
    next(
      token === 'none' ? request : HttpClientRequest.setHeader(request, 'cookie', `better-auth.session_token=${token}`),
    ),
  )
type Session = AuthorName | 'forged' | 'none'

/**
 * A typed client for every group, wired straight to the handlers of the provided `apiLayer`, that sends
 * `token` as its session. The client captures its middleware when it is made, so make one client per identity.
 * Like `HttpApiTest.groups`, plus the contract recorder: each request goes through the same encoding,
 * routing, middleware and decoding as the running API, in memory.
 */
export const clientAs = (token: Session) =>
  Effect.gen(function* () {
    const handler = yield* HttpRouter.toHttpEffect(HttpApiBuilder.layer(Api))
    const httpClient = HttpClient.make((request) =>
      Effect.gen(function* () {
        const response = yield* handler.pipe(
          Effect.provideService(HttpServerRequest.HttpServerRequest, HttpServerRequest.fromClientRequest(request)),
          Effect.orDie,
        )
        observe(request.method, request.url, response.status)
        return HttpServerResponse.toClientResponse(response, { request })
      }).pipe(Effect.scoped),
    )
    return yield* HttpApiClient.makeWith(Api, { httpClient, baseUrl: 'http://localhost:3000' })
  }).pipe(Effect.provide(session(token)))

/**
 * Where scripts/contract-coverage.ts finds the api layer's responses: with CONTRACT_OBSERVATIONS set to a
 * directory (verify:app sets it), every response of `clientAs` and `webHandler` is appended there as
 * `{ method, path, status }`, one JSON line each. Unset (pnpm check), nothing is written.
 */
const observe = (method: string, url: string, status: number) => {
  const directory = process.env.CONTRACT_OBSERVATIONS
  if (!directory) return
  mkdirSync(directory, { recursive: true })
  const line = JSON.stringify({ method, path: new URL(url).pathname, status })
  appendFileSync(join(directory, `api-${process.pid}.jsonl`), `${line}\n`)
}
