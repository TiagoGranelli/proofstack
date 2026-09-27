import type { InfiniteData, QueryClient } from '@tanstack/react-query'
import { getMyPostsQueryOptions } from '#/features/posts/api/get-my-posts.ts'
import { getPublicPostsQueryOptions } from '#/features/posts/api/get-public-posts.ts'
import type { Post, PostPage } from '#/sdk/types.gen.ts'

const updatePosts = (update: (posts: Array<Post>) => Array<Post>) => (data: InfiniteData<PostPage> | undefined) =>
  data && { ...data, pages: data.pages.map((page) => ({ ...page, items: update(page.items) })) }

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
  queryClient.setQueryData(
    getMyPostsQueryOptions().queryKey,
    updatePosts((posts) => posts.map((current) => (current.id === post.id ? post : current))),
  )

/** Hides a deleted post right away, before the refetch from invalidatePosts lands. */
export const dropMyPost = (queryClient: QueryClient, id: string) =>
  queryClient.setQueryData(
    getMyPostsQueryOptions().queryKey,
    updatePosts((posts) => posts.filter((current) => current.id !== id)),
  )
