// PostList: the empty state, read-only cards, and "Load more" (pending, failure, retry, focus, last page).
import { useSuspenseInfiniteQuery } from '@tanstack/react-query'
import { HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { getPublicPostsQueryOptions } from '#/features/posts/api/get-public-posts.ts'
import { PostList } from '#/features/posts/components/post-list.tsx'
import type { PostPage } from '#/sdk/types.gen.ts'
import { api, apiError, held, post, postPage, postPages, worker } from './api-mocks.ts'
import { pressAndKeepFocus, renderInApp, testQueryClient } from './test-utils.tsx'

/** The public list as src/routes/index.tsx renders it. */
function PublicPosts() {
  const pages = useSuspenseInfiniteQuery(getPublicPostsQueryOptions())
  return <PostList pages={pages} empty="No posts yet." testId="public-posts" />
}

/** Renders the list with `first` already loaded, as the route loader leaves it. */
const renderList = (first: PostPage) => {
  const queryClient = testQueryClient()
  queryClient.setQueryData(getPublicPostsQueryOptions().queryKey, postPages(first))
  return renderInApp(<PublicPosts />, { queryClient })
}

const loadMore = () => page.getByRole('button', { name: /^Load(ing)? more posts/ })
const items = () => page.getByRole('listitem')

const CURSOR = 'cursor-after-page-1'
const firstPage = postPage([post({ body: 'newest' }), post({ body: 'newer' })], CURSOR)
const secondPage = postPage([post({ body: 'older' }), post({ body: 'oldest' })])

/** Answers the request for the page after CURSOR with `respond`; records every cursor requested. */
const nextPage = (respond: () => Promise<Response> | Response) => {
  const cursors: Array<string | null> = []
  worker.use(
    api.publicPostsList(({ request }) => {
      cursors.push(new URL(request.url).searchParams.get('cursor'))
      return respond()
    }),
  )
  return cursors
}

describe('PostList', () => {
  it('shows the empty message in place of the list', async () => {
    await renderList(postPage([]))
    await expect.element(page.getByTestId('public-posts')).toHaveTextContent('No posts yet.')
    await expect.element(page.getByRole('list')).not.toBeInTheDocument()
    expect(page.getByRole('button').elements()).toHaveLength(0)
  })

  it('lists posts in the given order as read-only cards, without Load more on the last page', async () => {
    await renderList(postPage([post({ body: 'newer' }), post({ body: 'older', authorName: 'Other Author' })]))
    await expect.element(items().nth(0)).toHaveTextContent('newerTest Author · Jan 2, 2026')
    await expect.element(items().nth(1)).toHaveTextContent('olderOther Author · Jan 2, 2026')
    expect(items().elements()).toHaveLength(2)
    // `nextCursor: null`: no Load more button, and no other buttons on read-only cards.
    expect(page.getByRole('button').elements()).toHaveLength(0)
  })

  it('loads the next page with the cursor, busy meanwhile, then focuses its first post', async () => {
    const response = held()
    const cursors = nextPage(async () => {
      await response.wait()
      return HttpResponse.json(secondPage)
    })
    await renderList(firstPage)
    // aria-disabled, not disabled: the button keeps keyboard focus while the page loads, also once rendered.
    await pressAndKeepFocus(loadMore())
    await expect.element(loadMore()).toHaveTextContent('Loading more posts…')
    // Pressing it again while busy sends no second request.
    await userEvent.keyboard('{Enter}')
    expect(cursors).toEqual([CURSOR])

    response.release()
    await expect.element(items().nth(2)).toMatchTextContent(/^older/)
    await expect.element(items().nth(2)).toHaveFocus()
    expect(items().elements()).toHaveLength(4)
    // The second page ends the list.
    await expect.element(loadMore()).not.toBeInTheDocument()
    expect(cursors).toEqual([CURSOR])
  })

  it.each([
    [
      'a network failure',
      () => HttpResponse.error(),
      'Could not load more posts. Check your connection and try again.',
    ],
    ['an outage', () => new HttpResponse('', { status: 503 }), 'Could not load more posts. Try again.'],
  ])('reports %s, keeps the loaded posts and focus, and retries', async (_, failure, message) => {
    let fail = true
    const cursors = nextPage(() => (fail ? failure() : HttpResponse.json(secondPage)))
    await renderList(firstPage)
    await loadMore().click()

    await expect.element(page.getByRole('alert')).toHaveTextContent(message)
    await expect.element(loadMore()).toHaveTextContent('Load more posts')
    await expect.element(loadMore()).not.toHaveAttribute('aria-disabled')
    await expect.element(loadMore()).toHaveFocus()
    expect(items().elements()).toHaveLength(2)

    fail = false
    await loadMore().click()
    await expect.element(items().nth(2)).toHaveFocus()
    await expect.element(page.getByRole('alert')).not.toBeInTheDocument()
    expect(cursors).toEqual([CURSOR, CURSOR])
  })

  it('shows a rejected cursor as a failure of Load more', async () => {
    worker.use(
      apiError('publicPostsList', 400, {
        _tag: 'ValidationError',
        message: 'Invalid request query',
        issues: [{ path: ['cursor'], message: 'Expected a base64url encoded string' }],
      }),
    )
    await renderList(firstPage)
    await loadMore().click()
    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent('Could not load more posts: Expected a base64url encoded string')
    await expect.element(loadMore()).toHaveFocus()
    expect(items().elements()).toHaveLength(2)
  })
})
