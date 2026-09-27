// Hidden check of the eval task fix-post-length-check. .agents/evals/grade.sh copies it to tests/component/ after
// the agent has finished; it is never in the agent's checkout.
import { HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { POST_MAX_LENGTH } from '#/contract/limits.ts'
import { MyPost } from '#/features/posts/components/my-post.tsx'
import { PostComposer } from '#/features/posts/components/post-composer.tsx'
import { api, post, worker } from './api-mocks.ts'
import { renderInApp } from './test-utils.tsx'

const atLimit = `\n  ${'x'.repeat(POST_MAX_LENGTH)}  \n`
const count = () => page.getByText(/^\d+\/280/)

describe('eval: fix-post-length-check', () => {
  it('the composer accepts a body at the limit with whitespace around it', async () => {
    await renderInApp(<PostComposer />)
    const field = page.getByLabelText('New post')
    await field.fill(atLimit)
    await expect.element(count()).toHaveTextContent(`${POST_MAX_LENGTH}/${POST_MAX_LENGTH} characters.`)
    await expect.element(field).not.toHaveAttribute('aria-invalid')
    await expect.element(count()).not.toHaveClass('text-destructive')
    await expect.element(page.getByRole('button', { name: 'Publish' })).toBeEnabled()
  })

  it('the composer still flags one character over the limit', async () => {
    await renderInApp(<PostComposer />)
    const field = page.getByLabelText('New post')
    await field.fill(` ${'x'.repeat(POST_MAX_LENGTH + 1)} `)
    await expect.element(field).toHaveAttribute('aria-invalid', 'true')
    await expect.element(count()).toHaveClass('text-destructive')
  })

  it('the post editor accepts a body at the limit with whitespace around it', async () => {
    worker.use(api.myPostsUpdate(() => HttpResponse.json(post({ body: 'x'.repeat(POST_MAX_LENGTH) }))))
    await renderInApp(<MyPost post={post({ body: 'Short' })} />)
    await page.getByRole('button', { name: /^Edit/ }).click()
    const field = page.getByLabelText('Edit post')
    await field.fill(atLimit)
    await expect.element(field).not.toHaveAttribute('aria-invalid')
    await expect.element(page.getByRole('button', { name: 'Save' })).toBeEnabled()
  })
})
