import type { QueryClient } from '@tanstack/react-query'
import { apiClient } from '#/lib/api-client.ts'
import { myPostsListOptions, publicPostsListOptions } from '#/sdk/@tanstack/react-query.gen.ts'
import type { Post } from '#/sdk/types.gen.ts'

export const publicPostsQuery = () => publicPostsListOptions({ client: apiClient() })
export const myPostsQuery = () => myPostsListOptions({ client: apiClient() })

/**
 * After any write, both lists are out of date: the author's list (refetched now, it is on screen) and the
 * public list (only marked invalid; `/` waits for it on the next visit, see awaitPublicPostsAfterWrite).
 */
export const invalidatePosts = (queryClient: QueryClient) =>
  Promise.all([
    queryClient.invalidateQueries({ queryKey: myPostsQuery().queryKey }),
    queryClient.invalidateQueries({ queryKey: publicPostsQuery().queryKey }),
  ])

/** Shows a saved post right away, before the refetch from invalidatePosts lands. */
export const replaceMyPost = (queryClient: QueryClient, post: Post) =>
  queryClient.setQueryData(myPostsQuery().queryKey, (posts) =>
    posts?.map((current) => (current.id === post.id ? post : current)),
  )

/** Hides a deleted post right away, before the refetch from invalidatePosts lands. */
export const dropMyPost = (queryClient: QueryClient, id: string) =>
  queryClient.setQueryData(myPostsQuery().queryKey, (posts) => posts?.filter((current) => current.id !== id))

/**
 * For the `beforeLoad` of `/`. The router renders a route it has visited before at once and reloads its data
 * in the background (stale-while-revalidate), so after a write in this tab the old list would flash before
 * the new one. When a write invalidated the public list, this waits for the fresh list first (`beforeLoad`
 * always completes before the route renders). Data that is merely old keeps the instant navigation.
 */
export const awaitPublicPostsAfterWrite = async (queryClient: QueryClient) => {
  const query = publicPostsQuery()
  if (queryClient.getQueryState(query.queryKey)?.isInvalidated) await queryClient.fetchQuery(query)
}
