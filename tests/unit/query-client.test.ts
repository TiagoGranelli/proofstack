// createQueryClient (src/lib/query-client.ts): mutations declare their cache effects in `meta`, and its
// MutationCache performs them in the order the UI relies on, keeping the mutation pending until the refetch ends.
import { type InfiniteData, InfiniteQueryObserver, MutationObserver } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { createQueryClient } from '#/lib/query-client.ts'

const setup = async () => {
  const events: string[] = []
  const queryClient = createQueryClient()
  const list = (name: string) => ({
    queryKey: [name],
    queryFn: ({ pageParam }: { pageParam: number }) => {
      events.push(`fetch ${name} ${pageParam}`)
      return Promise.resolve(`${name} page ${pageParam}`)
    },
    initialPageParam: 0,
    getNextPageParam: (_: string, pages: string[]) => pages.length,
  })
  // Three pages each; only `mine` has an observer (on screen), `public` and `other` are inactive.
  for (const name of ['public', 'mine', 'other']) {
    await queryClient.infiniteQuery(list(name))
    queryClient.setQueryData<InfiniteData<string, number>>([name], {
      pages: [0, 1, 2].map((n) => `${name} page ${n}`),
      pageParams: [0, 1, 2],
    })
  }
  const unsubscribe = new InfiniteQueryObserver(queryClient, { ...list('mine'), staleTime: Infinity }).subscribe(
    () => {},
  )
  events.length = 0
  const pages = (name: string) => queryClient.getQueryData<InfiniteData<string>>([name])?.pages
  return { events, queryClient, pages, unsubscribe }
}

describe('createQueryClient', () => {
  it('refetches what a mutation invalidates after its onSuccess, before it resolves', async () => {
    const { events, queryClient, pages, unsubscribe } = await setup()
    const mutation = new MutationObserver(queryClient, {
      mutationFn: () => Promise.resolve('saved'),
      meta: {
        invalidates: [
          { queryKey: ['public'], inactiveToo: true, firstPageOnly: true },
          { queryKey: ['mine'] },
          { queryKey: ['other'] },
        ],
      },
      onSuccess: () => void events.push('caller onSuccess'),
    })
    await mutation.mutate(undefined)
    events.push('resolved')

    // The on-screen list refetches every page it holds; the public one only its first, although inactive; the
    // inactive `other` is only marked stale.
    expect(events).toEqual([
      'caller onSuccess',
      'fetch public 0',
      'fetch mine 0',
      'fetch mine 1',
      'fetch mine 2',
      'resolved',
    ])
    expect(pages('public')).toEqual(['public page 0'])
    expect(pages('mine')).toHaveLength(3)
    expect(queryClient.getQueryState(['other'])?.isInvalidated).toBe(true)
    unsubscribe()
  })

  it('invalidates after a failure only when the mutation says the failure means stale data', async () => {
    const { queryClient, unsubscribe } = await setup()
    const failing = (message: string) =>
      new MutationObserver(queryClient, {
        mutationFn: () => Promise.reject(new Error(message)),
        meta: {
          invalidates: [{ queryKey: ['other'] }],
          invalidatesOnError: (error) => error instanceof Error && error.message === 'gone',
        },
      })
    await expect(failing('offline').mutate(undefined)).rejects.toThrow('offline')
    expect(queryClient.getQueryState(['other'])?.isInvalidated).toBe(false)
    await expect(failing('gone').mutate(undefined)).rejects.toThrow('gone')
    expect(queryClient.getQueryState(['other'])?.isInvalidated).toBe(true)
    unsubscribe()
  })

  it('clears the cache before the caller onSuccess, and leaves it alone without meta', async () => {
    const { queryClient, pages, unsubscribe } = await setup()
    await new MutationObserver(queryClient, { mutationFn: () => Promise.resolve(null) }).mutate(undefined)
    expect(pages('mine')).toHaveLength(3)

    const seen: unknown[] = []
    await new MutationObserver(queryClient, {
      mutationFn: () => Promise.resolve(null),
      meta: { clearsCache: true },
      onSuccess: () => void seen.push(pages('mine')),
    }).mutate(undefined)
    expect(seen).toEqual([undefined])
    unsubscribe()
  })
})
