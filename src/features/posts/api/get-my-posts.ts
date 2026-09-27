import { infiniteQueryOptions, type SkipToken } from '@tanstack/react-query'
import { firstPage, nextPage } from '#/features/posts/api/post-pages.ts'
import { apiClient } from '#/lib/api-client.ts'
import { myPostsListInfiniteOptions } from '#/sdk/@tanstack/react-query.gen.ts'

/** The signed-in author's posts, newest first, in pages. Isomorphic, like getPublicPostsQueryOptions. */
export const getMyPostsQueryOptions = () => {
  const { queryFn, ...options } = myPostsListInfiniteOptions({ client: apiClient() })
  return infiniteQueryOptions({
    ...options,
    // Typed as possibly `skipToken` for disabled queries; the generated one is always a function, and
    // saying so lets suspense queries (which cannot be skipped) use these options.
    queryFn: queryFn as Exclude<typeof queryFn, SkipToken | undefined>,
    initialPageParam: firstPage,
    getNextPageParam: nextPage,
  })
}
