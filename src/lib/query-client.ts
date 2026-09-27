import {
  type InfiniteData,
  MutationCache,
  QueryClient,
  type QueryClientConfig,
  type QueryKey,
} from '@tanstack/react-query'

/** A query a mutation makes stale, and how to bring it back. */
export interface Invalidation {
  readonly queryKey: QueryKey
  /**
   * Refetch it even while nothing on screen reads it, so a cached route renders it fresh on the next visit
   * instead of first showing the old data. Otherwise only an active query refetches (the rest when next read).
   */
  readonly inactiveToo?: boolean
  /** An infinite list that is cut back to its first page before the refetch, instead of refetching every page. */
  readonly firstPageOnly?: boolean
}

/** What a mutation declares in `meta`; the MutationCache below acts on it. A type, not an interface: TanStack Query
 * only takes a `Record<string, unknown>`, which an interface is not assignable to. */
type CacheEffects = {
  /** Cleared before the caller's `onSuccess` (a different user, or none, from now on). */
  readonly clearsCache?: boolean
  /** Refetched after the caller's `onSuccess`; the mutation stays pending until they are fresh. */
  readonly invalidates?: ReadonlyArray<Invalidation>
  /** Also invalidate after this failure (the error says the cache is stale, such as a post already deleted). */
  readonly invalidatesOnError?: (error: unknown) => boolean
}

declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: CacheEffects
  }
}

const invalidate = (queryClient: QueryClient, invalidations: ReadonlyArray<Invalidation>) =>
  Promise.all(
    invalidations.map(({ queryKey, inactiveToo, firstPageOnly }) => {
      if (firstPageOnly)
        queryClient.setQueriesData<InfiniteData<unknown>>(
          { queryKey, exact: true },
          (data) => data && { pages: data.pages.slice(0, 1), pageParams: data.pageParams.slice(0, 1) },
        )
      return queryClient.invalidateQueries({ queryKey, refetchType: inactiveToo ? 'all' : 'active' })
    }),
  )

/**
 * The app's QueryClient (src/router.tsx, and the component tests). Mutations never invalidate by hand: they
 * declare `meta.clearsCache` and `meta.invalidates`, and this cache performs them. TanStack Query awaits the
 * cache's `onSuccess` before the mutation's own and its `onSettled` after, which gives the order the UI needs:
 * clear, then the caller's `onSuccess` (reset a form, navigate), then the refetch.
 */
export function createQueryClient(config: QueryClientConfig = {}): QueryClient {
  const queryClient: QueryClient = new QueryClient({
    ...config,
    mutationCache: new MutationCache({
      // TanStack Query passes the mutation last, after data, variables and context: its signature, not ours.
      // oxlint-disable-next-line eslint/max-params
      onSuccess: (_data, _variables, _context, mutation) => {
        if (mutation.meta?.clearsCache) queryClient.clear()
      },
      // Same: TanStack Query's positional signature, with the error second and the mutation last.
      // oxlint-disable-next-line eslint/max-params
      onSettled: (_data, error, _variables, _context, mutation) => {
        const meta = mutation.meta
        const stale = error === null || (meta?.invalidatesOnError?.(error) ?? false)
        return stale && meta?.invalidates ? invalidate(queryClient, meta.invalidates) : undefined
      },
    }),
  })
  return queryClient
}
