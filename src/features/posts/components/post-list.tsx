import type { InfiniteData, UseSuspenseInfiniteQueryResult } from '@tanstack/react-query'
import { useEffect, useRef, type ReactNode } from 'react'
import { ApiErrorAlert } from '#/components/errors/api-error-alert.tsx'
import { Button } from '#/components/ui/button.tsx'
import { PostCard } from '#/features/posts/components/post-card.tsx'
import type { Post, PostPage } from '#/sdk/types.gen.ts'

type PostPages = Pick<
  UseSuspenseInfiniteQueryResult<InfiniteData<PostPage>, unknown>,
  'data' | 'error' | 'fetchNextPage' | 'hasNextPage' | 'isFetchNextPageError' | 'isFetchingNextPage'
>

/**
 * A paged list of posts with a "Load more" button (not infinite scroll: the footer stays reachable and the
 * list only grows when asked). After a page loads, focus moves to its first post, so keyboard and screen
 * reader users continue reading where the new posts start instead of staying on a button below them.
 */
export function PostList(props: {
  pages: PostPages
  empty: string
  testId: string
  /** Renders one post. Defaults to a read-only card. */
  renderPost?: (post: Post) => ReactNode
}) {
  const { pages } = props
  const posts = pages.data.pages.flatMap((page) => page.items)
  const list = useRef<HTMLUListElement>(null)
  // Index of the first post the pending "Load more" adds; focused once it renders.
  const focusOnLoad = useRef<number | null>(null)

  useEffect(() => {
    const index = focusOnLoad.current
    if (index === null || posts.length <= index) return
    focusOnLoad.current = null
    list.current?.querySelectorAll<HTMLElement>(':scope > li')[index]?.focus()
  }, [posts.length])

  const loadMore = async () => {
    // aria-disabled rather than disabled while loading: a disabled button would drop keyboard focus.
    if (pages.isFetchingNextPage) return
    focusOnLoad.current = posts.length
    const fetched = await pages.fetchNextPage()
    // Nothing new rendered (an error, or the next page emptied meanwhile): focus stays on the button.
    if (fetched.isError || (fetched.data?.pages.at(-1)?.items.length ?? 0) === 0) focusOnLoad.current = null
  }

  if (posts.length === 0) {
    return (
      <p data-testid={props.testId} className="text-muted-foreground">
        {props.empty}
      </p>
    )
  }
  const renderPost = props.renderPost ?? ((post: Post) => <PostCard post={post} />)
  return (
    <div className="grid gap-3">
      <ul ref={list} data-testid={props.testId} className="grid gap-3">
        {posts.map((post) => (
          <li
            key={post.id}
            tabIndex={-1}
            className="rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {renderPost(post)}
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
          {pages.isFetchingNextPage ? 'Loading more posts…' : 'Load more posts'}
        </Button>
      ) : null}
      {pages.isFetchNextPageError ? <ApiErrorAlert error={pages.error} action="load more posts" /> : null}
    </div>
  )
}
