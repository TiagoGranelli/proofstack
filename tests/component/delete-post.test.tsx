// Deleting one of the author's posts (MyPost with DeletePostButton): the dialog that asks first, where focus goes,
// the pending state and every failure branch.
import { HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { getMyPostsQueryOptions } from '#/features/posts/api/get-my-posts.ts'
import { getPublicPostsQueryOptions } from '#/features/posts/api/get-public-posts.ts'
import { MyPost } from '#/features/posts/components/my-post.tsx'
import { api, apiError, apiFailure, held, post, postPage, postPages, worker } from './api-mocks.ts'
import { afterRendering, renderInApp } from './test-utils.tsx'

const original = post({ body: 'The original body' })
const editButton = () => page.getByRole('button', { name: /^Edit/ })
const deleteButton = () => page.getByRole('button', { name: /^Delete post/ })
const field = () => page.getByLabelText('Edit post')
const dialog = () => page.getByRole('alertdialog', { name: 'Delete this post?' })
const keepIt = () => dialog().getByRole('button', { name: 'Keep it' })
const confirmDelete = () => dialog().getByRole('button', { name: 'Delete', exact: true })
const card = () =>
  page.elementLocator(
    page
      .getByText(/^Test Author/)
      .element()
      .closest('[data-slot="card"]')!,
  )

/** Delete, then Delete again in the dialog that asks first. */
const deletePost = async () => {
  await deleteButton().click()
  await confirmDelete().click()
}

/** Opens the dialog and confirms from the keyboard (Enter on its Delete). */
const confirmWithKeyboard = async () => {
  await deleteButton().click()
  ;(confirmDelete().element() as HTMLElement).focus()
  await userEvent.keyboard('{Enter}')
}

/** A delete that waits for `release()`, then fails like a lost connection; `calls.count` counts the requests. */
const heldFailingDelete = () => {
  const response = held()
  const calls = { count: 0 }
  worker.use(
    api.myPostsRemove(async () => {
      calls.count++
      await response.wait()
      return HttpResponse.error()
    }),
  )
  return { release: response.release, calls }
}

describe('deleting a post', () => {
  it('asks first, with focus on Keep it; Keep it or Escape sends nothing and puts focus back on Delete', async () => {
    // No handler: a request would fail the test (setup.ts).
    await renderInApp(<MyPost post={original} />)
    ;(deleteButton().element() as HTMLElement).focus()
    await userEvent.keyboard('{Enter}')
    await expect
      .element(dialog())
      .toHaveAccessibleDescription('It will be gone for good, from your posts and from the public list.')
    await expect.element(dialog().getByText('The original body')).toBeVisible()
    await expect.element(keepIt()).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect.element(dialog()).not.toBeInTheDocument()
    await expect.element(deleteButton()).toHaveFocus()

    await userEvent.keyboard('{Enter}')
    await expect.element(keepIt()).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    await expect.element(dialog()).not.toBeInTheDocument()
    await expect.element(deleteButton()).toHaveFocus()
  })

  it('confirming gives focus back to Delete, which keeps it while the request runs and after it fails', async () => {
    const request = heldFailingDelete()
    await renderInApp(<MyPost post={original} />)
    await confirmWithKeyboard()
    await expect.element(deleteButton()).toHaveAttribute('aria-disabled', 'true')
    await afterRendering()
    await expect.element(deleteButton()).toHaveFocus()
    request.release()
    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent('Could not delete the post. Check your connection and try again.')
    await expect.element(deleteButton()).toHaveFocus()
    await expect.element(deleteButton()).not.toHaveAttribute('aria-disabled')
  })

  it('ignores Edit and Delete while deleting, and sends one request', async () => {
    const request = heldFailingDelete()
    await renderInApp(<MyPost post={original} />)
    await confirmWithKeyboard()
    await expect.element(editButton()).toHaveAttribute('aria-disabled', 'true')
    await userEvent.keyboard('{Enter}')
    await afterRendering()
    await expect.element(dialog()).not.toBeInTheDocument()
    ;(editButton().element() as HTMLElement).click()
    await afterRendering()
    await expect.element(field()).not.toBeInTheDocument()
    request.release()
    await expect.element(page.getByRole('alert')).toBeVisible()
    expect(request.calls.count).toBe(1)
  })

  it('is busy while deleting, then reports it and drops the post from the cached list', async () => {
    const response = held()
    worker.use(
      api.myPostsRemove(async () => {
        await response.wait()
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const onDeleted = vi.fn<() => void>()
    const { queryClient } = await renderInApp(<MyPost post={original} onDeleted={onDeleted} />)
    queryClient.setQueryData(getMyPostsQueryOptions().queryKey, postPages(postPage([original])))
    await deletePost()
    await expect.element(deleteButton()).toBeDisabled()
    await expect.element(editButton()).toBeDisabled()
    await expect.element(card()).toHaveAttribute('aria-busy', 'true')

    response.release()
    await expect.poll(() => onDeleted.mock.calls.length).toBe(1)
    expect(queryClient.getQueryData(getMyPostsQueryOptions().queryKey)).toEqual(postPages(postPage([])))
  })

  it('stays quiet when the post was already deleted elsewhere, and refreshes the lists', async () => {
    worker.use(apiError('myPostsRemove', 404, { _tag: 'PostNotFound', id: original.id }))
    const onDeleted = vi.fn<() => void>()
    const { queryClient } = await renderInApp(<MyPost post={original} onDeleted={onDeleted} />)
    queryClient.setQueryData(getPublicPostsQueryOptions().queryKey, postPages(postPage([original])))
    await deletePost()
    await expect.poll(() => queryClient.getQueryState(getPublicPostsQueryOptions().queryKey)?.isInvalidated).toBe(true)
    await expect.element(deleteButton()).toBeEnabled()
    await expect.element(page.getByRole('alert')).not.toBeInTheDocument()
    expect(onDeleted).not.toHaveBeenCalled()
  })

  it.each([
    [
      'an outage',
      () => apiFailure('myPostsRemove', { status: 503, text: '' }),
      'Could not delete the post. Try again.',
    ],
    [
      'an ended session',
      () => apiError('myPostsRemove', 401, { _tag: 'Unauthorized', message: 'Authentication required' }),
      'Your session has ended. Sign in again to continue. Sign in',
    ],
  ])('shows a delete failure caused by %s in the card', async (_, handler, message) => {
    worker.use(handler())
    await renderInApp(<MyPost post={original} />)
    await deletePost()
    await expect.element(page.getByRole('alert')).toHaveTextContent(message)
    await expect.element(deleteButton()).toBeEnabled()
  })
})
