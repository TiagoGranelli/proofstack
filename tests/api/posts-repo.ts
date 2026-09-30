// PostsRepo in memory for the api layer (./harness.ts), with the real repository's contract.
import { Layer } from 'effect'
import type { Post } from '#/contract/posts.ts'
import { PostsRepo } from '#/server/posts/repo.ts'
import { memoryQuery, type RepoOptions } from './memory-db.ts'
import { memoryClock, memoryPage } from './memory-keyset.ts'

/** A stored post: the public fields, its owner, and its sort key at Postgres's microsecond precision. */
type StoredPost = Post & { readonly authorId: string; readonly cursorAt: string }

const view = ({ id, body, authorName, createdAt, updatedAt }: StoredPost): Post => ({
  id,
  body,
  authorName,
  createdAt,
  updatedAt,
})

/**
 * PostsRepo in memory, with the real repository's contract: keyset pages ordered by (created_at, id) newest
 * first at microsecond precision, and ownership as part of the lookup (another author's id behaves like a
 * missing id).
 */
export const memoryPostsRepo = (options: RepoOptions) => {
  const db = memoryQuery(options)
  return Layer.sync(PostsRepo, () => {
    const posts: StoredPost[] = []
    const tick = memoryClock(options.clockStepMicros ?? 1_000_000)
    const owned = (authorId: string, id: string) => posts.findIndex((p) => p.id === id && p.authorId === authorId)
    return {
      listPublic: (page) => db(() => memoryPage(posts, page, view)),
      listByAuthor: (author, page) =>
        db(() =>
          memoryPage(
            posts.filter((p) => p.authorId === author.id),
            page,
            view,
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
