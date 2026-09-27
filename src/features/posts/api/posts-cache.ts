import type { InfiniteData, QueryClient } from '@tanstack/react-query'
import { getMyPostsQueryOptions } from '#/features/posts/api/get-my-posts.ts'
import { getPublicPostsQueryOptions } from '#/features/posts/api/get-public-posts.ts'
import type { Invalidation } from '#/lib/query-client.ts'
import type { Post, PostPage } from '#/sdk/types.gen.ts'

const updatePosts = (update: (posts: Array<Post>) => Array<Post>) => (data: InfiniteData<PostPage> | undefined) =>
  data && { ...data, pages: data.pages.map((page) => ({ ...page, items: update(page.items) })) }

/**
 * What every post write declares in `meta.invalidates`: both lists are out of date, and the mutation stays
 * pending until both are fresh again (src/lib/query-client.ts performs it):
 *
 * - The author's list is on screen: every page loaded so far is refetched, so the author keeps their place.
 * - The public list is usually not on screen (writes happen on the dashboard), but the router shows a cached
 *   route at once when it is revisited. It is cut back to its first page and refetched right away, even
 *   while inactive, so `/` renders the new list on the next visit without a request and without first
 *   flashing the old one. A list never visited in this tab is not in the cache: nothing to refetch, and the
 *   route's loader fetches it on the visit.
 */
export const postListsChanged = (): ReadonlyArray<Invalidation> => [
  { queryKey: getMyPostsQueryOptions().queryKey },
  { queryKey: getPublicPostsQueryOptions().queryKey, inactiveToo: true, firstPageOnly: true },
]

/** Shows a saved post right away, before the refetch of postListsChanged lands. */
export const replaceMyPost = (queryClient: QueryClient, post: Post) =>
  queryClient.setQueryData(
    getMyPostsQueryOptions().queryKey,
    updatePosts((posts) => posts.map((current) => (current.id === post.id ? post : current))),
  )

/** Hides a deleted post right away, before the refetch of postListsChanged lands. */
export const dropMyPost = (queryClient: QueryClient, id: string) =>
  queryClient.setQueryData(
    getMyPostsQueryOptions().queryKey,
    updatePosts((posts) => posts.filter((current) => current.id !== id)),
  )
