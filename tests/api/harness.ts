// In-memory harness for the Effect handlers: the real contract, handlers and RequestValidation middleware,
// with PostsRepo kept in an array and Authentication faked by session token. No database, no Better Auth
// call, no HTTP server: HttpApiTest sends the typed client's requests through the same encoding, routing,
// middleware and decoding as the running API.
import { Data, Effect, Layer, Redacted } from 'effect'
import { HttpClientRequest, HttpRouter, HttpServer } from 'effect/unstable/http'
import { HttpApiBuilder, HttpApiMiddleware, HttpApiTest } from 'effect/unstable/httpapi'
import { Api } from '#/contract/api.ts'
import { Unauthorized } from '#/contract/errors.ts'
import { Authentication, CurrentUser } from '#/contract/middleware.ts'
import type { Post } from '#/contract/posts.ts'
import { MyPostsHandlers, PublicPostsHandlers, SystemHandlers } from '#/server/api/handlers.ts'
import { RequestValidationLive } from '#/server/api/middleware.ts'
import { PostsRepo } from '#/server/posts/repo.ts'

/** The authors the fake session store knows, keyed by session token. */
export const authors = {
  alice: { id: 'user-alice', name: 'Alice', email: 'alice@example.test' },
  bob: { id: 'user-bob', name: 'Bob', email: 'bob@example.test' },
} as const
type AuthorName = keyof typeof authors

/** Same tag as the repository's private DbError: the handlers only look at `_tag`. */
class DbError extends Data.TaggedError('DbError')<{ readonly cause: unknown }> {}

type StoredPost = Post & { readonly authorId: string }

/**
 * PostsRepo in memory, with the real repository's contract: newest first, and ownership as part of the
 * lookup (another author's id behaves like a missing id). `databaseDown` makes every call fail like an
 * unreachable Postgres.
 */
const view = ({ id, body, authorName, createdAt, updatedAt }: StoredPost): Post => ({
  id,
  body,
  authorName,
  createdAt,
  updatedAt,
})

const memoryPostsRepo = (options: { databaseDown?: boolean }) => {
  const db = <A>(run: () => A) =>
    options.databaseDown ? Effect.fail(new DbError({ cause: new Error('connect ECONNREFUSED') })) : Effect.sync(run)
  return Layer.sync(PostsRepo, () => {
    const posts: StoredPost[] = []
    let clock = Date.UTC(2026, 0, 1)
    const tick = () => new Date((clock += 1000)).toISOString()
    const newestFirst = (list: StoredPost[]) => list.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))
    const owned = (authorId: string, id: string) => posts.findIndex((p) => p.id === id && p.authorId === authorId)
    return {
      listPublic: (limit) => db(() => newestFirst(posts).slice(0, limit).map(view)),
      listByAuthor: (author) => db(() => newestFirst(posts.filter((p) => p.authorId === author.id)).map(view)),
      create: (author, body) =>
        db(() => {
          const now = tick()
          const post: StoredPost = {
            id: crypto.randomUUID(),
            body,
            authorName: author.name,
            authorId: author.id,
            createdAt: now,
            updatedAt: now,
          }
          posts.push(post)
          return view(post)
        }),
      update: (author, id, body) =>
        db(() => {
          const index = owned(author.id, id)
          if (index === -1) return undefined
          const post = { ...posts[index]!, body, updatedAt: tick() }
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
 * The handlers under test, over a fresh in-memory repository (provide it per test for isolation).
 * Middleware is provided with `provideMerge` because the HTTP pipeline also resolves it when the routes
 * are built.
 */
export const apiLayer = (options: { databaseDown?: boolean } = {}) =>
  Layer.mergeAll(SystemHandlers, PublicPostsHandlers, MyPostsHandlers).pipe(
    Layer.provide(memoryPostsRepo(options)),
    Layer.provideMerge(Layer.mergeAll(FakeAuthentication, RequestValidationLive)),
    Layer.merge(HttpServer.layerServices),
  )

/**
 * The same handlers as a web-standard `(Request) => Promise<Response>`, built like
 * src/server/api/web-handler.ts, for input the typed client refuses to encode (it validates payloads
 * before sending them). Call `dispose` when done.
 */
export const webHandler = () =>
  HttpRouter.toWebHandler(HttpApiBuilder.layer(Api).pipe(Layer.provide(apiLayer())), { disableLogger: true })

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
 * A typed client for every group, wired straight to the handlers, that sends `token` as its session. The
 * client captures its middleware when it is made, so make one client per identity.
 */
export const clientAs = (token: Session) =>
  HttpApiTest.groups(Api, ['system', 'publicPosts', 'myPosts']).pipe(Effect.provide(session(token)))
