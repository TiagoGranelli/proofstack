import '@tanstack/react-start/server-only'
import { and, desc, eq, sql } from 'drizzle-orm'
import { Context, Data, Effect, Layer } from 'effect'
import type { Post } from '#/contract/posts.ts'
import { Database } from '../db/client.ts'
import { post, user } from '../db/schema/index.ts'

class DbError extends Data.TaggedError('DbError')<{ readonly cause: unknown }> {}

const query = <A>(run: () => Promise<A>) => Effect.tryPromise({ try: run, catch: (cause) => new DbError({ cause }) })

const toPost = (row: { id: string; body: string; createdAt: Date; updatedAt: Date }, authorName: string): Post => ({
  id: row.id,
  body: row.body,
  authorName,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
})

const listColumns = {
  id: post.id,
  body: post.body,
  createdAt: post.createdAt,
  updatedAt: post.updatedAt,
  authorName: user.name,
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface Author {
  readonly id: string
  readonly name: string
}

export class PostsRepo extends Context.Service<
  PostsRepo,
  {
    readonly listPublic: (limit: number) => Effect.Effect<ReadonlyArray<Post>, DbError>
    readonly listByAuthor: (author: Author) => Effect.Effect<ReadonlyArray<Post>, DbError>
    readonly create: (author: Author, body: string) => Effect.Effect<Post, DbError>
    readonly update: (author: Author, id: string, body: string) => Effect.Effect<Post | undefined, DbError>
    readonly remove: (author: Author, id: string) => Effect.Effect<boolean, DbError>
    readonly ping: Effect.Effect<void, DbError>
  }
>()('proofstack/PostsRepo') {
  static readonly layer = Layer.effect(
    PostsRepo,
    Effect.gen(function* () {
      const db = yield* Database
      return {
        listPublic: Effect.fn('PostsRepo.listPublic')(function* (limit) {
          const rows = yield* query(() =>
            db
              .select(listColumns)
              .from(post)
              .innerJoin(user, eq(user.id, post.authorId))
              .orderBy(desc(post.createdAt))
              .limit(limit),
          )
          return rows.map((r) => toPost(r, r.authorName))
        }),
        listByAuthor: Effect.fn('PostsRepo.listByAuthor')(function* (author) {
          const rows = yield* query(() =>
            db.select().from(post).where(eq(post.authorId, author.id)).orderBy(desc(post.createdAt)),
          )
          return rows.map((r) => toPost(r, author.name))
        }),
        create: Effect.fn('PostsRepo.create')(function* (author, body) {
          const [row] = yield* query(() => db.insert(post).values({ authorId: author.id, body }).returning())
          return toPost(row!, author.name)
        }),
        // Ownership is part of the WHERE clause, so another author's id behaves exactly like a missing id.
        update: Effect.fn('PostsRepo.update')(function* (author, id, body) {
          if (!UUID.test(id)) return undefined
          const [row] = yield* query(() =>
            db
              .update(post)
              .set({ body })
              .where(and(eq(post.id, id), eq(post.authorId, author.id)))
              .returning(),
          )
          return row ? toPost(row, author.name) : undefined
        }),
        remove: Effect.fn('PostsRepo.remove')(function* (author, id) {
          if (!UUID.test(id)) return false
          const rows = yield* query(() =>
            db
              .delete(post)
              .where(and(eq(post.id, id), eq(post.authorId, author.id)))
              .returning({ id: post.id }),
          )
          return rows.length > 0
        }),
        ping: query(() => db.execute(sql`select 1`)).pipe(Effect.asVoid),
      }
    }),
  )
}
