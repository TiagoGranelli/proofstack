// In-memory harness for the Effect handlers: the real contract, handlers, RequestValidation and WriteRateLimit
// middleware, with PostsRepo and the rate-limit counters kept in memory and Authentication faked by session
// token. No database, no Better Auth call, no HTTP server: the typed client's requests go through the same
// encoding, routing, middleware and decoding as the running API.
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { Data, Effect, Layer, Redacted } from 'effect'
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
import { Unauthorized } from '#/contract/errors.ts'
import { Authentication, CurrentUser } from '#/contract/middleware.ts'
import type { PageCursor, Post, PostPage } from '#/contract/posts.ts'
import { MyPostsHandlers, PublicPostsHandlers, SystemHandlers } from '#/server/api/handlers.ts'
import { RequestValidationLive } from '#/server/api/middleware.ts'
import { RateLimitStore, WriteRateLimitLive } from '#/server/api/rate-limit.ts'
import { PostsRepo, type PageRequest } from '#/server/posts/repo.ts'

/** The authors the fake session store knows, keyed by session token. */
export const authors = {
  alice: { id: 'user-alice', name: 'Alice', email: 'alice@example.test' },
  bob: { id: 'user-bob', name: 'Bob', email: 'bob@example.test' },
} as const
type AuthorName = keyof typeof authors

/** Same tag as the repository's private DbError: the handlers only look at `_tag`. */
class DbError extends Data.TaggedError('DbError')<{ readonly cause: unknown }> {}

/** A stored post: the public fields, its owner, and its sort key at Postgres's microsecond precision. */
type StoredPost = Post & { readonly authorId: string; readonly cursorAt: string }

const view = ({ id, body, authorName, createdAt, updatedAt }: StoredPost): Post => ({
  id,
  body,
  authorName,
  createdAt,
  updatedAt,
})

/** The (createdAt, id) keyset order of src/server/posts/repo.ts, newest first. Postgres compares uuids bytewise, which for lower-case hex is string order. */
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const compareKeys = (a: PageCursor, b: PageCursor) =>
  compare(a.createdAt, b.createdAt) || compare(a.id.toLowerCase(), b.id.toLowerCase())
const keyOf = (post: StoredPost): PageCursor => ({ createdAt: post.cursorAt, id: post.id })

/** One page like the real repository: the first `limit` posts with a key below the cursor, and the last one's key when more remain. */
const toPage = (list: ReadonlyArray<StoredPost>, { cursor, limit }: PageRequest): PostPage => {
  const after = list
    .filter((post) => cursor === undefined || compareKeys(keyOf(post), cursor) < 0)
    .toSorted((a, b) => compareKeys(keyOf(b), keyOf(a)))
  const items = after.slice(0, limit)
  const last = items.at(-1)
  return { items: items.map((item) => view(item)), nextCursor: after.length > limit && last ? keyOf(last) : null }
}

export interface RepoOptions {
  /** Every call fails like an unreachable Postgres. */
  readonly databaseDown?: boolean
  /**
   * Microseconds the clock advances per write (default one second). `1` puts several posts in the same
   * millisecond (equal `createdAt` on the wire, distinct sort keys); `0` gives them the same instant, so
   * only the id orders them.
   */
  readonly clockStepMicros?: number
}

/**
 * PostsRepo in memory, with the real repository's contract: keyset pages ordered by (created_at, id) newest
 * first at microsecond precision, and ownership as part of the lookup (another author's id behaves like a
 * missing id).
 */
const memoryPostsRepo = (options: RepoOptions) => {
  const db = <A>(run: () => A) =>
    options.databaseDown ? Effect.fail(new DbError({ cause: new Error('connect ECONNREFUSED') })) : Effect.sync(run)
  const step = options.clockStepMicros ?? 1_000_000
  return Layer.sync(PostsRepo, () => {
    const posts: StoredPost[] = []
    const start = Date.UTC(2026, 0, 1)
    let micros = 0
    /** The wire timestamp (milliseconds, as `toISOString` rounds a JS Date) and the full-precision sort key. */
    const tick = () => {
      micros += step
      const iso = new Date(start + Math.floor(micros / 1000)).toISOString()
      return { iso, key: `${iso.slice(0, 23)}${String(micros % 1000).padStart(3, '0')}Z` }
    }
    const owned = (authorId: string, id: string) => posts.findIndex((p) => p.id === id && p.authorId === authorId)
    return {
      listPublic: (page) => db(() => toPage(posts, page)),
      listByAuthor: (author, page) =>
        db(() =>
          toPage(
            posts.filter((p) => p.authorId === author.id),
            page,
          ),
        ),
      create: (author, body) =>
        db(() => {
          const now = tick()
          const post: StoredPost = {
            id: crypto.randomUUID(),
            body,
            authorName: author.name,
            authorId: author.id,
            createdAt: now.iso,
            updatedAt: now.iso,
            cursorAt: now.key,
          }
          posts.push(post)
          return view(post)
        }),
      update: (author, id, body) =>
        db(() => {
          const index = owned(author.id, id)
          if (index === -1) return undefined
          const post = { ...posts[index]!, body, updatedAt: tick().iso }
          posts[index] = post
          return view(post)
        }),
      remove: (author, id) =>
        db(() => {
          const index = owned(author.id, id)
          if (index !== -1) posts.splice(index, 1)
          return index !== -1
        }),
      ping: db(() => undefined),
    }
  })
}

/** Server side: the session token is the author's key in `authors`; anything else is a 401. */
const authenticate: Authentication['Service']['sessionCookie'] = (httpEffect, { credential }) => {
  const token = Redacted.value(credential)
  if (!Object.hasOwn(authors, token)) return Effect.fail(new Unauthorized({ message: 'Authentication required' }))
  return Effect.provideService(httpEffect, CurrentUser, authors[token as AuthorName])
}
const FakeAuthentication = Layer.succeed(Authentication, {
  sessionCookie: authenticate,
  secureSessionCookie: authenticate,
})

/**
 * RateLimitStore in memory, per layer, with the rule of the Postgres store (src/server/auth-rate-limit.ts) on a
 * virtual clock where every request takes one second: a window starts at the first request and restarts once
 * `window` seconds passed since the last admitted one, and a refused request waits for the rest of it. So
 * after `max` admitted requests in a row, the next ones are told to wait `window - 1`, `window - 2`, ... seconds.
 */
const memoryRateLimitStore = Layer.sync(RateLimitStore, () => {
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
  Layer.mergeAll(SystemHandlers, PublicPostsHandlers, MyPostsHandlers).pipe(
    Layer.provide(memoryPostsRepo(options)),
    Layer.provideMerge(
      Layer.mergeAll(
        FakeAuthentication,
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
