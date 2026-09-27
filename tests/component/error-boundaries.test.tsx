// Where failures stop: the route-level errorComponent of /dashboard and /account (their loaders), and
// SectionErrorBoundary, which keeps one failing part of a page from taking down the rest.
import { Suspense } from 'react'
import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { SectionErrorBoundary } from '#/components/errors/section-error-boundary.tsx'
import { MyPostList } from '#/features/posts/components/my-post-list.tsx'
import { PostComposer } from '#/features/posts/components/post-composer.tsx'
import { Route as AccountRoute } from '#/routes/_authed/account.tsx'
import { Route as DashboardRoute } from '#/routes/_authed/dashboard.tsx'
import { api, apiError, apiFailure, authFunction, post, postPage, worker } from './api-mocks.ts'
import { renderInApp } from './test-utils.tsx'

const tryAgain = () => page.getByRole('button', { name: 'Try again' })

describe('route errorComponent', () => {
  it('names what failed when the dashboard cannot load the posts', async () => {
    worker.use(apiFailure('myPostsList', { network: true }))
    await renderInApp(null, { url: '/dashboard', route: { path: '/dashboard', route: DashboardRoute } })
    await expect.element(page.getByRole('heading', { level: 1 })).toHaveTextContent('Your posts could not be loaded')
    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent('Could not load your posts. Check your connection and try again.')
    await expect.element(tryAgain()).toBeEnabled()
    await expect.element(page.getByRole('link', { name: 'Go to the home page' })).toHaveAttribute('href', '/')
  })

  it('offers to sign in when the dashboard hit an ended session', async () => {
    worker.use(apiError('myPostsList', 401, { _tag: 'Unauthorized', message: 'Authentication required' }))
    await renderInApp(null, { url: '/dashboard', route: { path: '/dashboard', route: DashboardRoute } })
    await expect
      .element(page.getByRole('alert').getByRole('link', { name: 'Sign in' }))
      .toHaveAttribute('href', '/login?redirect=%2Fdashboard')
  })

  it('names what failed when the account page cannot load the sessions', async () => {
    worker.use(authFunction('listSessions', 'thrown'))
    await renderInApp(null, { url: '/account', route: { path: '/account', route: AccountRoute } })
    await expect.element(page.getByRole('heading', { level: 1 })).toHaveTextContent('Your account could not be loaded')
    await expect.element(page.getByRole('alert')).toHaveTextContent('Could not load your account. Try again.')
    expect(document.body.textContent).not.toContain('Internal Server Error')
  })
})

let renderFails = true
function Flaky() {
  if (renderFails) throw new Error('raw failure details')
  return <p>Rendered after all</p>
}

describe('SectionErrorBoundary', () => {
  it('shows the failure in place, keeps the rest of the page, and retries on request', async () => {
    renderFails = true
    await renderInApp(
      <main>
        <h1>Page</h1>
        <SectionErrorBoundary action="show this part">
          <Flaky />
        </SectionErrorBoundary>
        <button type="button">Still here</button>
      </main>,
    )
    await expect.element(page.getByRole('alert')).toHaveTextContent('Could not show this part. Try again.')
    expect(document.body.textContent).not.toContain('raw failure details')
    await expect.element(page.getByRole('heading', { name: 'Page' })).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Still here' })).toBeEnabled()

    renderFails = false
    await tryAgain().click()
    await expect.element(page.getByText('Rendered after all')).toBeVisible()
    await expect.element(page.getByRole('alert')).not.toBeInTheDocument()
  })

  it('on the dashboard, a failing list leaves the composer working, and Try again refetches the list', async () => {
    worker.use(apiFailure('myPostsList', { network: true }))
    await renderInApp(
      <>
        <SectionErrorBoundary action="show the post form">
          <PostComposer />
        </SectionErrorBoundary>
        <SectionErrorBoundary action="show your posts">
          <Suspense fallback={<p>Loading…</p>}>
            <MyPostList />
          </Suspense>
        </SectionErrorBoundary>
      </>,
      { url: '/dashboard' },
    )
    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent('Could not show your posts. Check your connection and try again.')
    await page.getByLabelText('New post').fill('Still writing')
    await expect.element(page.getByRole('button', { name: 'Publish' })).toBeEnabled()

    worker.use(api.myPostsList({ body: postPage([post({ body: 'Back again' })]) }))
    await tryAgain().click()
    await expect.element(page.getByTestId('my-posts').getByText('Back again', { exact: true })).toBeVisible()
    await expect.element(page.getByLabelText('New post')).toHaveValue('Still writing')
  })
})
