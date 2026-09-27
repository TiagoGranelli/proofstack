import type { QueryClient } from '@tanstack/react-query'
import { getMyPostsQueryOptions } from '#/features/posts/api/get-my-posts.ts'
import { getPublicPostsQueryOptions } from '#/features/posts/api/get-public-posts.ts'
import type { Post } from '#/sdk/types.gen.ts'

/**
 * After any write, both lists are out of date: the author's list (refetched now, it is on screen) and the
 * public list (only marked invalid; `/` waits for it on the next visit, see awaitPublicPostsAfterWrite).
 */
export const invalidatePosts = (queryClient: QueryClient) =>
  Promise.all([
    queryClient.invalidateQueries({ queryKey: getMyPostsQueryOptions().queryKey }),
    queryClient.invalidateQueries({ queryKey: getPublicPostsQueryOptions().queryKey }),
  ])

/** Shows a saved post right away, before the refetch from invalidatePosts lands. */
export const replaceMyPost = (queryClient: QueryClient, post: Post) =>
  queryClient.setQueryData(getMyPostsQueryOptions().queryKey, (posts) =>
    posts?.map((current) => (current.id === post.id ? post : current)),
  )

/** Hides a deleted post right away, before the refetch from invalidatePosts lands. */
export const dropMyPost = (queryClient: QueryClient, id: string) =>
  queryClient.setQueryData(getMyPostsQueryOptions().queryKey, (posts) => posts?.filter((current) => current.id !== id))
