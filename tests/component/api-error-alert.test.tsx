// ApiErrorAlert renders describeApiError's view (its branches are pinned in tests/unit/api-error.test.ts)
// as an alert, with a sign-in link back to the current page when the session has ended.
import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { ApiErrorAlert } from '#/components/errors/api-error-alert.tsx'
import { renderInApp } from './test-utils.tsx'

describe('ApiErrorAlert', () => {
  const cases: Array<[string, unknown, string]> = [
    [
      'a network failure',
      new TypeError('Failed to fetch'),
      'Could not save your changes. Check your connection and try again.',
    ],
    ['a non-JSON body', 'Forbidden', 'Could not save your changes. Try again.'],
    ['an empty body', {}, 'Could not save your changes. Try again.'],
    [
      'a ValidationError',
      {
        _tag: 'ValidationError',
        message: 'Invalid request payload',
        issues: [{ path: ['body'], message: 'Too long.' }],
      },
      'Could not save your changes: Too long.',
    ],
    [
      'a PostNotFound',
      { _tag: 'PostNotFound', id: 'x' },
      'This post no longer exists. It may have been deleted elsewhere.',
    ],
    [
      'a ServiceUnavailable',
      { _tag: 'ServiceUnavailable', message: 'Database unavailable' },
      'The service is temporarily unavailable. Try again in a moment.',
    ],
  ]

  it.each(cases)('announces %s without a sign-in link', async (_, error, message) => {
    await renderInApp(<ApiErrorAlert id="err" error={error} action="save your changes" />)
    const alert = page.getByRole('alert')
    await expect.element(alert).toHaveTextContent(message)
    await expect.element(alert).toHaveAttribute('id', 'err')
    expect(page.getByRole('link').elements()).toHaveLength(0)
  })

  it('offers to sign in again, returning to the current page', async () => {
    const { router } = await renderInApp(
      <ApiErrorAlert error={{ _tag: 'Unauthorized', message: 'Authentication required' }} action="save your changes" />,
      { url: '/dashboard?tab=1' },
    )
    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent('Your session has ended. Sign in again to continue. Sign in')
    const signIn = page.getByRole('alert').getByRole('link', { name: 'Sign in' })
    await expect.element(signIn).toHaveAttribute('href', '/login?redirect=%2Fdashboard%3Ftab%3D1')
    await signIn.click()
    await expect.poll(() => router.state.location.href).toBe('/login?redirect=%2Fdashboard%3Ftab%3D1')
  })
})
