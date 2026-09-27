import type { QueryClient } from '@tanstack/react-query'
import { apiClient } from '#/lib/api-client.ts'
import { publicPostsListOptions } from '#/sdk/@tanstack/react-query.gen.ts'

/** Every author's posts, newest first. Isomorphic: in-process during SSR, same-origin fetch in the browser. */
export const getPublicPostsQueryOptions = () => publicPostsListOptions({ client: apiClient() })

/**
 * For the `beforeLoad` of `/`. The router renders a route it has visited before at once and reloads its data
 * in the background (stale-while-revalidate), so after a write in this tab the old list would flash before
 * the new one. When a write invalidated the public list, this waits for the fresh list first (`beforeLoad`
 * always completes before the route renders). Data that is merely old keeps the instant navigation.
 */
export const awaitPublicPostsAfterWrite = async (queryClient: QueryClient) => {
  const query = getPublicPostsQueryOptions()
  if (queryClient.getQueryState(query.queryKey)?.isInvalidated) await queryClient.fetchQuery(query)
}
