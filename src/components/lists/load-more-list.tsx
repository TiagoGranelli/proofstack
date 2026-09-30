import type { InfiniteData, UseSuspenseInfiniteQueryResult } from '@tanstack/react-query'
import { useEffect, useRef, type ReactNode } from 'react'
import { ApiErrorAlert } from '#/components/errors/api-error-alert.tsx'
import { Button } from '#/components/ui/button.tsx'

/** The part of a suspense infinite query over `{ items, nextCursor }` pages that the list reads. */
type Pages<Item> = Pick<
  UseSuspenseInfiniteQueryResult<InfiniteData<{ readonly items: ReadonlyArray<Item> }>, unknown>,
  'data' | 'error' | 'fetchNextPage' | 'hasNextPage' | 'isFetchNextPageError' | 'isFetchingNextPage'
>

/**
 * A paged list with a "Load more" button (not infinite scroll: the footer stays reachable and the list only grows
 * when asked). After a page loads, focus moves to its first item, so keyboard and screen reader users continue
 * reading where the new items start instead of staying on a button below them.
 */
export function LoadMoreList<Item extends { readonly id: string }>(props: {
  pages: Pages<Item>
  /** Names the items in the button and its error: `posts` gives "Load more posts". */
  noun: string
  empty: string
  testId: string
  renderItem: (entry: Item) => ReactNode
}) {
  const { pages, noun } = props
  const items = pages.data.pages.flatMap((page) => page.items)
  const list = useRef<HTMLUListElement>(null)
  // Index of the first item the pending "Load more" adds; focused once it renders.
  const focusOnLoad = useRef<number | null>(null)

  useEffect(() => {
    const index = focusOnLoad.current
    if (index === null || items.length <= index) return
    focusOnLoad.current = null
    list.current?.querySelectorAll<HTMLElement>(':scope > li')[index]?.focus()
  }, [items.length])

  const loadMore = async () => {
    // aria-disabled rather than disabled while loading: a disabled button would drop keyboard focus.
    if (pages.isFetchingNextPage) return
    focusOnLoad.current = items.length
    const fetched = await pages.fetchNextPage()
    // Nothing new rendered (an error, or the next page emptied meanwhile): focus stays on the button.
    if (fetched.isError || (fetched.data?.pages.at(-1)?.items.length ?? 0) === 0) focusOnLoad.current = null
  }

  if (items.length === 0) {
    return (
      <p data-testid={props.testId} className="text-muted-foreground">
        {props.empty}
      </p>
    )
  }
  return (
    <div className="grid gap-3">
      <ul ref={list} data-testid={props.testId} className="grid gap-3">
        {items.map((entry) => (
          <li key={entry.id} tabIndex={-1} className="rounded-xl">
            {props.renderItem(entry)}
          </li>
        ))}
      </ul>
      {pages.hasNextPage ? (
        <Button
          type="button"
          variant="outline"
          className="justify-self-center"
          aria-disabled={pages.isFetchingNextPage || undefined}
          onClick={() => void loadMore()}
        >
          {pages.isFetchingNextPage ? `Loading more ${noun}…` : `Load more ${noun}`}
        </Button>
      ) : null}
      {pages.isFetchNextPageError ? <ApiErrorAlert error={pages.error} action={`load more ${noun}`} /> : null}
    </div>
  )
}
