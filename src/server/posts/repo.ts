import '@tanstack/react-start/server-only'
import { and, desc, eq, sql, type SQL } from 'drizzle-orm'
import { Context, Data, Effect, Layer } from 'effect'
import type { PageCursor, Post, PostPage } from '#/contract/posts.ts'
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

const pageColumns = {
  id: post.id,
  body: post.body,
  createdAt: post.createdAt,
  updatedAt: post.updatedAt,
  // The sort key at full (microsecond) precision. `createdAt` as a JS Date is rounded to milliseconds, and a
  // cursor built from it would skip or repeat posts created within the same millisecond.
  cursorAt: sql<string>`to_char(${post.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
}

/** A page of a list ordered by (created_at desc, id desc): the first `limit` posts after the cursor's key. */
export interface PageRequest {
  readonly cursor?: PageCursor | undefined
  readonly limit: number
}

// A row-value comparison, which Postgres answers from the (…, created_at desc, id desc) indexes: the scan
// starts right after the cursor instead of skipping over an offset.
const afterCursor = (cursor: PageCursor | undefined): SQL | undefined =>
  cursor ? sql`(${post.createdAt}, ${post.id}) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)` : undefined

const newestFirst = [desc(post.createdAt), desc(post.id)]

interface PageRow {
  readonly id: string
  readonly body: string
  readonly createdAt: Date
  readonly updatedAt: Date
  readonly cursorAt: string
}

/** `rows` come from a query with `limit + 1`: the extra row only tells whether another page exists. */
const toPage = <R extends PageRow>(rows: ReadonlyArray<R>, limit: number, authorName: (row: R) => string): PostPage => {
  const items = rows.slice(0, limit)
  const last = items.at(-1)
  return {
    items: items.map((row) => toPost(row, authorName(row))),
    nextCursor: rows.length > limit && last ? { createdAt: last.cursorAt, id: last.id } : null,
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface Author {
  readonly id: string
  readonly name: string
}

export class PostsRepo extends Context.Service<
  PostsRepo,
  {
    readonly listPublic: (page: PageRequest) => Effect.Effect<PostPage, DbError>
    readonly listByAuthor: (author: Author, page: PageRequest) => Effect.Effect<PostPage, DbError>
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
        listPublic: Effect.fn('PostsRepo.listPublic')(function* (page) {
          const rows = yield* query(() =>
            db
              .select({ ...pageColumns, authorName: user.name })
              .from(post)
              .innerJoin(user, eq(user.id, post.authorId))
              .where(afterCursor(page.cursor))
              .orderBy(...newestFirst)
              .limit(page.limit + 1),
          )
          return toPage(rows, page.limit, (row) => row.authorName)
        }),
        listByAuthor: Effect.fn('PostsRepo.listByAuthor')(function* (author, page) {
          const rows = yield* query(() =>
            db
              .select(pageColumns)
              .from(post)
              .where(and(eq(post.authorId, author.id), afterCursor(page.cursor)))
              .orderBy(...newestFirst)
              .limit(page.limit + 1),
          )
          return toPage(rows, page.limit, () => author.name)
        }),
        create: Effect.fn('PostsRepo.create')(function* (author, body) {
          const [row] = yield* query(() => db.insert(post).values({ authorId: author.id, body }).returning())
          // INSERT … RETURNING yields the inserted row; none at all is a driver defect, not an outcome to handle.
          if (!row) return yield* Effect.die(new Error('INSERT … RETURNING returned no row'))
          return toPost(row, author.name)
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
