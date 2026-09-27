import '@tanstack/react-start/server-only'
import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { Api } from '#/contract/api.ts'
import { ServiceUnavailable } from '#/contract/errors.ts'
import { CurrentUser } from '#/contract/middleware.ts'
import { PostNotFound } from '#/contract/posts.ts'
import { PostsRepo } from '../posts/repo.ts'

const PUBLIC_PAGE_SIZE = 50

export const SystemHandlers = HttpApiBuilder.group(
  Api,
  'system',
  Effect.fn(function* (handlers) {
    const repo = yield* PostsRepo
    return handlers
      .handle('health', () => Effect.succeed({ status: 'ok' as const }))
      .handle('ready', () =>
        repo.ping.pipe(
          Effect.as({ status: 'ok' as const }),
          Effect.catchTag('DbError', () => Effect.fail(new ServiceUnavailable({ message: 'Database unavailable' }))),
        ),
      )
  }),
)

export const PublicPostsHandlers = HttpApiBuilder.group(
  Api,
  'publicPosts',
  Effect.fn(function* (handlers) {
    const repo = yield* PostsRepo
    return handlers.handle('list', () => repo.listPublic(PUBLIC_PAGE_SIZE).pipe(Effect.orDie))
  }),
)

export const MyPostsHandlers = HttpApiBuilder.group(
  Api,
  'myPosts',
  Effect.fn(function* (handlers) {
    const repo = yield* PostsRepo
    return handlers
      .handle('list', () => CurrentUser.use((author) => repo.listByAuthor(author)).pipe(Effect.orDie))
      .handle('create', ({ payload }) =>
        CurrentUser.use((author) => repo.create(author, payload.body)).pipe(Effect.orDie),
      )
      .handle('update', ({ params, payload }) =>
        Effect.gen(function* () {
          const author = yield* CurrentUser
          const updated = yield* repo.update(author, params.id, payload.body).pipe(Effect.orDie)
          if (!updated) return yield* new PostNotFound({ id: params.id })
          return updated
        }),
      )
      .handle('remove', ({ params }) =>
        Effect.gen(function* () {
          const author = yield* CurrentUser
          const removed = yield* repo.remove(author, params.id).pipe(Effect.orDie)
          if (!removed) return yield* new PostNotFound({ id: params.id })
        }),
      )
  }),
)
