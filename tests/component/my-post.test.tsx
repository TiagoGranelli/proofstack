// MyPost: edit mode, focus management, pending states and every failure branch of save. Delete: delete-post.test.tsx.
import { HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { POST_MAX_LENGTH } from '#/contract/limits.ts'
import { getMyPostsQueryOptions } from '#/features/posts/api/get-my-posts.ts'
import { MyPost } from '#/features/posts/components/my-post.tsx'
import { api, apiError, apiFailure, held, post, listPage, listPages, worker } from './api-mocks.ts'
import { afterRendering, pressAndKeepFocus, renderInApp } from './test-utils.tsx'

const original = post({ body: 'The original body' })
const editButton = () => page.getByRole('button', { name: /^Edit/ })
const deleteButton = () => page.getByRole('button', { name: /^Delete post/ })
const field = () => page.getByLabelText('Edit post')
const save = () => page.getByRole('button', { name: 'Save' })
const cancel = () => page.getByRole('button', { name: 'Cancel' })

const startEditing = async () => {
  await editButton().click()
  await expect.element(field()).toHaveFocus()
}

const saveEdit = async (draft: string) => {
  await startEditing()
  await field().fill(draft)
  await save().click()
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

  it('leaves focus where it is when it mounts', async () => {
    await renderInApp(<MyPost post={original} />)
    await expect.element(editButton()).toBeVisible()
    await afterRendering()
    expect(document.activeElement).toBe(document.body)
  })

  it.each([
    ['the Cancel button', () => cancel().click()],
    ['Escape', () => userEvent.keyboard('{Escape}')],
  ])('%s discards the draft and returns focus to Edit', async (_, dismiss) => {
    await renderInApp(<MyPost post={original} />)
    await startEditing()
    // Typed key by key, so only Escape, not any other key, may close the editor.
    await userEvent.keyboard(' and a discarded draft')
    await expect.element(field()).toHaveValue('The original body and a discarded draft')
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
    const onUpdated = vi.fn<() => void>()
    const { queryClient } = await renderInApp(<MyPost post={original} onUpdated={onUpdated} />)
    queryClient.setQueryData(getMyPostsQueryOptions().queryKey, listPages(listPage([original])))
    await saveEdit('  The new body \n')
    await expect.element(save()).toBeDisabled()
    await expect.poll(() => sent).toEqual([{ id: original.id, body: 'The new body' }])

    response.release()
    await expect.element(field()).not.toBeInTheDocument()
    await expect.element(editButton()).toHaveFocus()
    expect(onUpdated).toHaveBeenCalledOnce()
    // The cached list shows the saved post before its refetch, and both lists are invalidated.
    expect(queryClient.getQueryData(getMyPostsQueryOptions().queryKey)?.pages[0]?.items[0]?.body).toBe('The new body')
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
      message: 'Too long.',
      fieldLevel: true,
    },
    {
      name: 'a PostNotFound',
      handler: () => apiError('myPostsUpdate', 404, { _tag: 'PostNotFound', id: original.id }),
      message: 'This post no longer exists. It may have been deleted elsewhere.',
      fieldLevel: false,
    },
    {
      name: 'an ended session',
      handler: () => apiError('myPostsUpdate', 401, { _tag: 'Unauthorized', message: 'Authentication required' }),
      message: 'Your session has ended. Sign in again to continue. Sign in',
      fieldLevel: false,
    },
    {
      name: 'a network failure',
      handler: () => apiFailure('myPostsUpdate', { network: true }),
      message: 'Could not save the post. Check your connection and try again.',
      fieldLevel: false,
    },
  ]
  it.each(saveFailures)(
    'keeps the draft on $name, then Cancel clears the error',
    async ({ handler, message, fieldLevel }) => {
      worker.use(handler())
      const onUpdated = vi.fn<() => void>()
      await renderInApp(<MyPost post={original} onUpdated={onUpdated} />)
      await saveEdit('my draft')

      await expect.element(page.getByRole('alert')).toHaveTextContent(message)
      await expect.element(field()).toHaveValue('my draft')
      // A ValidationError is shown next to the field it names and marks it invalid; any other failure goes under the
      // form and still describes the draft.
      const id = `edit-post-${original.id}`
      expect(field().element().getAttribute('aria-invalid')).toBe(fieldLevel ? 'true' : null)
      await expect
        .element(field())
        .toHaveAttribute('aria-describedby', `${id}-count ${fieldLevel ? `${id}-error` : `${id}-alert`}`)
      expect(onUpdated).not.toHaveBeenCalled()

      await cancel().click()
      await startEditing()
      await expect.element(page.getByRole('alert')).not.toBeInTheDocument()
      await expect.element(field()).not.toHaveAttribute('aria-invalid')
    },
  )

  it('clears a failed save’s error when the next attempt starts, and shows it only if that one fails too', async () => {
    worker.use(apiFailure('myPostsUpdate', { network: true }))
    await renderInApp(<MyPost post={original} />)
    await saveEdit('my draft')
    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent('Could not save the post. Check your connection and try again.')

    const response = held()
    worker.use(
      api.myPostsUpdate(async () => {
        await response.wait()
        return HttpResponse.json({ ...original, body: 'my draft', updatedAt: '2026-01-03T00:00:00.000Z' })
      }),
    )
    await save().click()
    await expect.element(page.getByRole('alert')).not.toBeInTheDocument()
    await expect.element(field()).not.toHaveAttribute('aria-invalid')
    response.release()
    await expect.element(field()).not.toBeInTheDocument()
  })

  it('keeps focus on Save while saving and after a failure, and ignores a second press', async () => {
    const response = held()
    let requests = 0
    worker.use(
      api.myPostsUpdate(async () => {
        requests++
        await response.wait()
        return HttpResponse.error()
      }),
    )
    await renderInApp(<MyPost post={original} />)
    await startEditing()
    await pressAndKeepFocus(save())
    await userEvent.keyboard('{Enter}')
    response.release()
    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent('Could not save the post. Check your connection and try again.')
    await expect.element(save()).toHaveFocus()
    expect(requests).toBe(1)
  })
})
