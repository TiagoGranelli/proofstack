import '@tanstack/react-start/server-only'
import { and, eq } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'
import type { PostId, UserId } from '#/contract/ids.ts'
import type { Post, PostPage } from '#/contract/posts.ts'
import { Database, type Db } from '../db/client.ts'
import { keyset, toPage, type PageRequest } from '../db/keyset.ts'
import { type DbError, isUuid, query } from '../db/query.ts'
import { post, user } from '../db/schema/index.ts'

const toPost = (row: { id: PostId; body: string; createdAt: Date; updatedAt: Date }, authorName: string): Post => ({
  id: row.id,
  body: row.body,
  authorName,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
})

const posts = keyset(post)

const pageColumns = {
  id: post.id,
  body: post.body,
  createdAt: post.createdAt,
  updatedAt: post.updatedAt,
  cursorAt: posts.cursorAt,
}

interface Author {
  readonly id: UserId
  readonly name: string
}

const listPublic = Effect.fn('PostsRepo.listPublic')(function* (own: Db, page: PageRequest) {
  const rows = yield* query(own, (db) =>
    db
      .select({ ...pageColumns, authorName: user.name })
      .from(post)
      .innerJoin(user, eq(user.id, post.authorId))
      .where(posts.after(page.cursor))
      .orderBy(...posts.newestFirst)
      .limit(page.limit + 1),
  )
  return toPage(rows, page.limit, (row) => toPost(row, row.authorName))
})

const listByAuthor = Effect.fn('PostsRepo.listByAuthor')(function* (own: Db, author: Author, page: PageRequest) {
  const rows = yield* query(own, (db) =>
    db
      .select(pageColumns)
      .from(post)
      .where(and(eq(post.authorId, author.id), posts.after(page.cursor)))
      .orderBy(...posts.newestFirst)
      .limit(page.limit + 1),
  )
  return toPage(rows, page.limit, (row) => toPost(row, author.name))
})

const create = Effect.fn('PostsRepo.create')(function* (own: Db, author: Author, body: string) {
  const [row] = yield* query(own, (db) => db.insert(post).values({ authorId: author.id, body }).returning())
  // INSERT … RETURNING yields the inserted row; none at all is a driver defect, not an outcome to handle.
  if (!row) return yield* Effect.die(new Error(`INSERT … RETURNING returned no row for a post by author ${author.id}`))
  return toPost(row, author.name)
})

/** A new body for the post `id`. */
interface Edit {
  readonly id: PostId
  readonly body: string
}

// Ownership is part of the WHERE clause, so another author's id behaves exactly like a missing id.
const update = Effect.fn('PostsRepo.update')(function* (own: Db, author: Author, edit: Edit) {
  if (!isUuid(edit.id)) return undefined
  const [row] = yield* query(own, (db) =>
    db
      .update(post)
      .set({ body: edit.body })
      .where(and(eq(post.id, edit.id), eq(post.authorId, author.id)))
      .returning(),
  )
  return row ? toPost(row, author.name) : undefined
})

const remove = Effect.fn('PostsRepo.remove')(function* (own: Db, author: Author, id: PostId) {
  if (!isUuid(id)) return false
  const rows = yield* query(own, (db) =>
    db
      .delete(post)
      .where(and(eq(post.id, id), eq(post.authorId, author.id)))
      .returning({ id: post.id }),
  )
  return rows.length > 0
})

/** The posts table: public and per-author pages, and an author's writes, ownership checked in each query. */
export class PostsRepo extends Context.Service<
  PostsRepo,
  {
    readonly listPublic: (page: PageRequest) => Effect.Effect<PostPage, DbError>
    readonly listByAuthor: (author: Author, page: PageRequest) => Effect.Effect<PostPage, DbError>
    readonly create: (author: Author, body: string) => Effect.Effect<Post, DbError>
    readonly update: (author: Author, id: PostId, body: string) => Effect.Effect<Post | undefined, DbError>
    readonly remove: (author: Author, id: PostId) => Effect.Effect<boolean, DbError>
  }
>()('app/PostsRepo') {
  static readonly layer = Layer.effect(
    PostsRepo,
    Effect.gen(function* () {
      const own = yield* Database
      return {
        listPublic: (page) => listPublic(own, page),
        listByAuthor: (author, page) => listByAuthor(own, author, page),
        create: (author, body) => create(own, author, body),
        update: (author, id, body) => update(own, author, { id, body }),
        remove: (author, id) => remove(own, author, id),
      }
    }),
  )
}
