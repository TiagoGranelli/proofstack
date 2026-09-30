import '@tanstack/react-start/server-only'
import { Effect, Layer } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { Api } from '#/contract/api.ts'
import { ServiceUnavailable } from '#/contract/errors.ts'
import { CurrentUser } from '#/contract/middleware.ts'
import { PostNotFound } from '#/contract/posts.ts'
import { DatabaseHealth } from '../db/health.ts'
import { pageRequest } from '../db/keyset.ts'
import { isDraining } from '../lifecycle.ts'
import { PostsRepo } from '../posts/repo.ts'

// A draining process is not ready, whatever the database says: the load balancer stops routing to it while it
// finishes what it has (../lifecycle.ts).
const readiness = (database: DatabaseHealth['Service']) =>
  Effect.suspend(() => {
    if (isDraining()) return Effect.fail(new ServiceUnavailable({ message: 'Shutting down' }))
    return database.ping.pipe(
      Effect.as({ status: 'ok' as const }),
      Effect.catchTag('DbError', () => Effect.fail(new ServiceUnavailable({ message: 'Database unavailable' }))),
    )
  })

/** GET /api/health (the process answers) and GET /api/ready (it can serve: not draining, database up). */
const SystemHandlers = HttpApiBuilder.group(
  Api,
  'system',
  Effect.fn(function* (handlers) {
    const database = yield* DatabaseHealth
    return handlers
      .handle('health', () => Effect.succeed({ status: 'ok' as const }))
      .handle('ready', () => readiness(database))
  }),
)

/** The session's user, as the Authentication middleware resolved it: no query of its own. */
const MeHandlers = HttpApiBuilder.group(Api, 'me', (handlers) =>
  handlers.handle('get', () => CurrentUser.use(Effect.succeed)),
)

/** The public feed, newest first, a page at a time. Needs no session. */
const PublicPostsHandlers = HttpApiBuilder.group(
  Api,
  'publicPosts',
  Effect.fn(function* (handlers) {
    const repo = yield* PostsRepo
    return handlers.handle('list', ({ query }) => repo.listPublic(pageRequest(query)).pipe(Effect.orDie))
  }),
)

type Repo = PostsRepo['Service']

/** Edits one of the signed-in author's posts; another author's post is as missing as a deleted one (404). */
const updateOwnPost = (repo: Repo, id: string, body: string) =>
  Effect.gen(function* () {
    const author = yield* CurrentUser
    const updated = yield* repo.update(author, id, body).pipe(Effect.orDie)
    if (!updated) return yield* new PostNotFound({ id })
    return updated
  })

/** Deletes one of the signed-in author's posts, with the same 404 as `updateOwnPost`. */
const removeOwnPost = (repo: Repo, id: string) =>
  Effect.gen(function* () {
    const author = yield* CurrentUser
    const removed = yield* repo.remove(author, id).pipe(Effect.orDie)
    if (!removed) return yield* new PostNotFound({ id })
  })

/** The signed-in author's own posts: list, create, update and remove, behind the Authentication middleware. */
const MyPostsHandlers = HttpApiBuilder.group(
  Api,
  'myPosts',
  Effect.fn(function* (handlers) {
    const repo = yield* PostsRepo
    return handlers
      .handle('list', ({ query }) =>
        CurrentUser.use((author) => repo.listByAuthor(author, pageRequest(query))).pipe(Effect.orDie),
      )
      .handle('create', ({ payload }) =>
        CurrentUser.use((author) => repo.create(author, payload.body)).pipe(Effect.orDie),
      )
      .handle('update', ({ params, payload }) => updateOwnPost(repo, params.id, payload.body))
      .handle('remove', ({ params }) => removeOwnPost(repo, params.id))
  }),
)

/**
 * Every handler group of the contract, the one list both the running API (./web-handler.ts) and the api test layer
 * (tests/api/harness.ts) provide: a new group goes here, and each of those two adds the Layers it needs.
 */
export const ApiHandlers = Layer.mergeAll(SystemHandlers, MeHandlers, PublicPostsHandlers, MyPostsHandlers)
