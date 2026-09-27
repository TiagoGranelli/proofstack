// PostComposer: states the E2E suite cannot reach cheaply (pending, every error branch, the exact limit).
import { HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { POST_MAX_LENGTH } from '#/contract/limits.ts'
import { getPublicPostsQueryOptions } from '#/features/posts/api/get-public-posts.ts'
import { PostComposer } from '#/features/posts/components/post-composer.tsx'
import { api, apiError, apiFailure, held, post, worker } from './api-mocks.ts'
import { renderInApp } from './test-utils.tsx'

const field = () => page.getByLabelText('New post')
const publish = () => page.getByRole('button', { name: 'Publish' })
const count = () => page.getByText(/^\d+\/280/)
/** The form has no accessible name (so no `form` role): reach it from its field. */
const form = () => page.elementLocator(field().element().closest('form')!)

describe('PostComposer', () => {
  it('starts empty, with Publish disabled until there is non-blank text', async () => {
    await renderInApp(<PostComposer />)
    await expect.element(field()).toHaveValue('')
    await expect.element(field()).toBeRequired()
    await expect.element(publish()).toBeDisabled()
    await field().fill('   \n  ')
    await expect.element(publish()).toBeDisabled()
    await field().fill(' hi ')
    await expect.element(publish()).toBeEnabled()
  })

  it('counts the trimmed length and flags only a body over the limit', async () => {
    await renderInApp(<PostComposer />)
    await expect.element(field()).toHaveAccessibleDescription(`0/${POST_MAX_LENGTH} characters.`)

    await field().fill(`  ${'x'.repeat(POST_MAX_LENGTH)}  `)
    await expect.element(count()).toHaveTextContent(`${POST_MAX_LENGTH}/${POST_MAX_LENGTH} characters.`)
    await expect.element(field()).not.toHaveAttribute('aria-invalid')
    await expect.element(count()).not.toHaveClass('text-destructive')

    await field().fill('x'.repeat(POST_MAX_LENGTH + 1))
    await expect.element(field()).toHaveAttribute('aria-invalid', 'true')
    await expect.element(count()).toHaveClass('text-destructive')
    await expect
      .element(field())
      .toHaveAccessibleDescription(
        `${POST_MAX_LENGTH + 1}/${POST_MAX_LENGTH} characters. Over the ${POST_MAX_LENGTH}-character limit.`,
      )
    // Not truncated or blocked: the author may still trim it, and the server's answer is shown.
    await expect.element(publish()).toBeEnabled()
  })

  it('is busy while publishing, then clears the draft, reports success and invalidates the public list', async () => {
    const response = held()
    const sent: unknown[] = []
    worker.use(
      api.myPostsCreate(async ({ request }) => {
        sent.push(await request.json())
        await response.wait()
        return HttpResponse.json(post({ body: 'hello' }), { status: 201 })
      }),
    )
    const onPublished = vi.fn()
    const { queryClient } = await renderInApp(<PostComposer onPublished={onPublished} />)
    queryClient.setQueryData(getPublicPostsQueryOptions().queryKey, [])

    await field().fill('  hello \n')
    await publish().click()
    await expect.element(publish()).toBeDisabled()
    await expect.element(form()).toHaveAttribute('aria-busy', 'true')
    await expect.poll(() => sent).toEqual([{ body: 'hello' }])

    response.release()
    await expect.element(field()).toHaveValue('')
    expect(onPublished).toHaveBeenCalledOnce()
    await expect.element(form()).toHaveAttribute('aria-busy', 'false')
    expect(queryClient.getQueryState(getPublicPostsQueryOptions().queryKey)?.isInvalidated).toBe(true)
  })

  const failures = [
    {
      name: 'a ValidationError',
      handler: () =>
        apiError('myPostsCreate', 400, {
          _tag: 'ValidationError',
          message: 'Invalid request payload',
          issues: [{ path: ['body'], message: 'Expected a value with a length of at most 280' }],
        }),
      message: 'Could not publish the post: Expected a value with a length of at most 280',
    },
    {
      name: 'an ended session',
      handler: () => apiError('myPostsCreate', 401, { _tag: 'Unauthorized', message: 'Authentication required' }),
      message: 'Your session has ended. Sign in again to continue. Sign in',
    },
    {
      name: 'a network failure',
      handler: () => apiFailure('myPostsCreate', { network: true }),
      message: 'Could not publish the post. Check your connection and try again.',
    },
    {
      name: 'a CSRF rejection (plain-text 403)',
      handler: () => apiFailure('myPostsCreate', { status: 403, text: 'Forbidden' }),
      message: 'Could not publish the post. Try again.',
    },
  ]
  it.each(failures)('keeps the draft and describes $name', async ({ handler, message }) => {
    worker.use(handler())
    const onPublished = vi.fn()
    await renderInApp(<PostComposer onPublished={onPublished} />)
    await field().fill('keep me')
    await publish().click()

    await expect.element(page.getByRole('alert')).toHaveTextContent(message)
    await expect.element(field()).toHaveValue('keep me')
    await expect.element(field()).toHaveAttribute('aria-invalid', 'true')
    await expect.element(field()).toHaveAttribute('aria-describedby', 'post-body-count post-body-error')
    await expect.element(publish()).toBeEnabled()
    expect(onPublished).not.toHaveBeenCalled()
  })
})
