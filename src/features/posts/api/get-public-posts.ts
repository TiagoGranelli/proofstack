import { infiniteQueryOptions, type QueryClient, type SkipToken } from '@tanstack/react-query'
import { firstPage, nextPage } from '#/features/posts/api/post-pages.ts'
import { apiClient } from '#/lib/api-client.ts'
import { publicPostsListInfiniteOptions } from '#/sdk/@tanstack/react-query.gen.ts'

/**
 * Every author's posts, newest first, one page per "Load more". Isomorphic: in-process during SSR,
 * same-origin fetch in the browser.
 */
export const getPublicPostsQueryOptions = () => {
  const { queryFn, ...options } = publicPostsListInfiniteOptions({ client: apiClient() })
  return infiniteQueryOptions({
    ...options,
    // Typed as possibly `skipToken` for disabled queries; the generated one is always a function, and
    // saying so lets suspense queries (which cannot be skipped) use these options.
    queryFn: queryFn as Exclude<typeof queryFn, SkipToken | undefined>,
    initialPageParam: firstPage,
    getNextPageParam: nextPage,
  })
}

/**
 * For the `beforeLoad` of `/`. The router renders a route it has visited before at once and reloads its data
 * in the background (stale-while-revalidate), so after a write in this tab the old list would flash before
 * the new one. When a write invalidated the public list, this waits for the fresh list first (`beforeLoad`
 * always completes before the route renders). Data that is merely old keeps the instant navigation.
 */
export const awaitPublicPostsAfterWrite = async (queryClient: QueryClient) => {
  const query = getPublicPostsQueryOptions()
  if (queryClient.getQueryState(query.queryKey)?.isInvalidated) await queryClient.fetchInfiniteQuery(query)
}
