// MyPost: edit mode, focus management, pending states and every failure branch of save and delete.
import { HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { POST_MAX_LENGTH } from '#/contract/limits.ts'
import { getMyPostsQueryOptions } from '#/features/posts/api/get-my-posts.ts'
import { getPublicPostsQueryOptions } from '#/features/posts/api/get-public-posts.ts'
import { MyPost } from '#/features/posts/components/my-post.tsx'
import { api, apiError, apiFailure, held, post, worker } from './api-mocks.ts'
import { renderInApp } from './test-utils.tsx'

const original = post({ body: 'The original body' })
const editButton = () => page.getByRole('button', { name: /^Edit/ })
const deleteButton = () => page.getByRole('button', { name: /^Delete/ })
const field = () => page.getByLabelText('Edit post')
const save = () => page.getByRole('button', { name: 'Save' })
const cancel = () => page.getByRole('button', { name: 'Cancel' })
const card = () =>
  page.elementLocator(
    page
      .getByText(/^Test Author/)
      .element()
      .closest('[data-slot="card"]')!,
  )

const startEditing = async () => {
  await editButton().click()
  await expect.element(field()).toHaveFocus()
}

describe('MyPost', () => {
  it('shows the post with Edit and Delete buttons named after it', async () => {
    await renderInApp(<MyPost post={original} />)
    await expect.element(page.getByText('The original body')).toBeVisible()
    await expect.element(editButton()).toHaveAccessibleName('Edit post: The original body')
    await expect.element(deleteButton()).toHaveAccessibleName('Delete post: The original body')
    await expect.element(page.getByText('Test Author · Jan 2, 2026')).toBeVisible()
  })

  it('marks an edited post', async () => {
    await renderInApp(<MyPost post={{ ...original, updatedAt: '2026-01-03T00:00:00.000Z' }} />)
    await expect.element(page.getByText('Test Author · Jan 2, 2026 · edited')).toBeVisible()
  })

  it('opens the editor with the body, focused with the caret at the end', async () => {
    await renderInApp(<MyPost post={original} />)
    await startEditing()
    await expect.element(field()).toHaveValue('The original body')
    const textarea = field().element() as HTMLTextAreaElement
    expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([17, 17])
    await expect.element(field()).toHaveAccessibleDescription(`17/${POST_MAX_LENGTH} characters.`)
  })

  it.each([
    ['the Cancel button', () => cancel().click()],
    ['Escape', () => userEvent.keyboard('{Escape}')],
  ])('%s discards the draft and returns focus to Edit', async (_, dismiss) => {
    await renderInApp(<MyPost post={original} />)
    await startEditing()
    await field().fill('a discarded draft')
    await dismiss()
    await expect.element(field()).not.toBeInTheDocument()
    await expect.element(editButton()).toHaveFocus()
    await expect.element(page.getByText('The original body')).toBeVisible()

    await startEditing()
    await expect.element(field()).toHaveValue('The original body')
  })

  it('disables Save for a blank draft and flags one over the limit', async () => {
    await renderInApp(<MyPost post={original} />)
    await startEditing()
    await field().fill('  ')
    await expect.element(save()).toBeDisabled()
    await field().fill('x'.repeat(POST_MAX_LENGTH + 1))
    await expect.element(save()).toBeEnabled()
    await expect.element(field()).toHaveAttribute('aria-invalid', 'true')
  })

  it('saves the trimmed draft, busy meanwhile, then leaves the editor with focus on Edit', async () => {
    const response = held()
    const sent: unknown[] = []
    worker.use(
      api.myPostsUpdate(async ({ request, params }) => {
        sent.push({ id: params.id, ...(await request.json()) })
        await response.wait()
        return HttpResponse.json({ ...original, body: 'The new body', updatedAt: '2026-01-03T00:00:00.000Z' })
      }),
    )
    const onUpdated = vi.fn()
    const { queryClient } = await renderInApp(<MyPost post={original} onUpdated={onUpdated} />)
    queryClient.setQueryData(getMyPostsQueryOptions().queryKey, [original])
    await startEditing()
    await field().fill('  The new body \n')
    await save().click()
    await expect.element(save()).toBeDisabled()
    await expect.poll(() => sent).toEqual([{ id: original.id, body: 'The new body' }])

    response.release()
    await expect.element(field()).not.toBeInTheDocument()
    await expect.element(editButton()).toHaveFocus()
    expect(onUpdated).toHaveBeenCalledOnce()
    // The cached list shows the saved post before its refetch, and both lists are invalidated.
    expect(queryClient.getQueryData(getMyPostsQueryOptions().queryKey)?.[0]?.body).toBe('The new body')
    expect(queryClient.getQueryState(getMyPostsQueryOptions().queryKey)?.isInvalidated).toBe(true)
  })

  const saveFailures = [
    {
      name: 'a ValidationError',
      handler: () =>
        apiError('myPostsUpdate', 400, {
          _tag: 'ValidationError',
          message: 'Invalid request payload',
          issues: [{ path: ['body'], message: 'Too long.' }],
        }),
      message: 'Could not save the post: Too long.',
    },
    {
      name: 'a PostNotFound',
      handler: () => apiError('myPostsUpdate', 404, { _tag: 'PostNotFound', id: original.id }),
      message: 'This post no longer exists. It may have been deleted elsewhere.',
    },
    {
      name: 'an ended session',
      handler: () => apiError('myPostsUpdate', 401, { _tag: 'Unauthorized', message: 'Authentication required' }),
      message: 'Your session has ended. Sign in again to continue. Sign in',
    },
    {
      name: 'a network failure',
      handler: () => apiFailure('myPostsUpdate', { network: true }),
      message: 'Could not save the post. Check your connection and try again.',
    },
  ]
  it.each(saveFailures)('keeps the draft on $name, then Cancel clears the error', async ({ handler, message }) => {
    worker.use(handler())
    const onUpdated = vi.fn()
    await renderInApp(<MyPost post={original} onUpdated={onUpdated} />)
    await startEditing()
    await field().fill('my draft')
    await save().click()

    await expect.element(page.getByRole('alert')).toHaveTextContent(message)
    await expect.element(field()).toHaveValue('my draft')
    await expect.element(field()).toHaveAttribute('aria-invalid', 'true')
    await expect
      .element(field())
      .toHaveAttribute('aria-describedby', `edit-post-${original.id}-count edit-post-${original.id}-error`)
    expect(onUpdated).not.toHaveBeenCalled()

    await cancel().click()
    await startEditing()
    await expect.element(page.getByRole('alert')).not.toBeInTheDocument()
    await expect.element(field()).not.toHaveAttribute('aria-invalid')
  })

  it('is busy while deleting, then reports it and drops the post from the cached list', async () => {
    const response = held()
    worker.use(
      api.myPostsRemove(async () => {
        await response.wait()
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const onDeleted = vi.fn()
    const { queryClient } = await renderInApp(<MyPost post={original} onDeleted={onDeleted} />)
    queryClient.setQueryData(getMyPostsQueryOptions().queryKey, [original])
    await deleteButton().click()
    await expect.element(deleteButton()).toBeDisabled()
    await expect.element(editButton()).toBeDisabled()
    await expect.element(card()).toHaveAttribute('aria-busy', 'true')

    response.release()
    await expect.poll(() => onDeleted.mock.calls.length).toBe(1)
    expect(queryClient.getQueryData(getMyPostsQueryOptions().queryKey)).toEqual([])
  })

  it('stays quiet when the post was already deleted elsewhere, and refreshes the lists', async () => {
    worker.use(apiError('myPostsRemove', 404, { _tag: 'PostNotFound', id: original.id }))
    const onDeleted = vi.fn()
    const { queryClient } = await renderInApp(<MyPost post={original} onDeleted={onDeleted} />)
    queryClient.setQueryData(getPublicPostsQueryOptions().queryKey, [original])
    await deleteButton().click()
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
    await deleteButton().click()
    await expect.element(page.getByRole('alert')).toHaveTextContent(message)
    await expect.element(deleteButton()).toBeEnabled()
  })
})
