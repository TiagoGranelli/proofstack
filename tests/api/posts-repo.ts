// PostsRepo in memory for the api layer (./harness.ts), with the real repository's contract.
import { Layer } from 'effect'
import type { PageCursor, Post, PostPage } from '#/contract/posts.ts'
import { PostsRepo, type PageRequest } from '#/server/posts/repo.ts'
import { memoryQuery, type RepoOptions } from './memory-db.ts'

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
const compare = (a: string, b: string) => {
  if (a === b) return 0
  return a < b ? -1 : 1
}
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
  return { items: items.map((post) => view(post)), nextCursor: after.length > limit && last ? keyOf(last) : null }
}

/**
 * PostsRepo in memory, with the real repository's contract: keyset pages ordered by (created_at, id) newest
 * first at microsecond precision, and ownership as part of the lookup (another author's id behaves like a
 * missing id).
 */
export const memoryPostsRepo = (options: RepoOptions) => {
  const db = memoryQuery(options)
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
    }
  })
}
