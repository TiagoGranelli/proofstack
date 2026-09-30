// axe (WCAG 2.2 AA + best practices) on every page and UI state the app has. To cover a new page or state, add
// one entry to STATES: a name and the steps that reach it (helpers in ./support/app.ts); its landmark snapshot goes
// in ./landmarks.spec.ts.
import type { APIRequestContext, Page } from '@playwright/test'
import { APP_NAME } from '#/config/app.ts'
import { expectAccessible } from './support/a11y.ts'
import {
  dashboardWithMyPost,
  expect,
  failServerFunctionPosts,
  lastPage,
  navigateWithApiResponse,
  overTheLimit,
  seedPost,
  signIn,
  test,
  visit,
  type Author,
} from './support/app.ts'

type Fixtures = { page: Page; request: APIRequestContext; author: Author }

const STATES: Record<string, (fixtures: Fixtures) => Promise<unknown>> = {
  'home with posts': async ({ page, request, author }) => {
    const { body } = await seedPost(request, author)
    await visit(page, '/')
    await expect(page.getByTestId('public-posts').locator(':scope > li').filter({ hasText: body })).toBeVisible()
  },
  'home, no posts yet': async ({ page }) => {
    await navigateWithApiResponse(page, '/api/posts', { json: lastPage() })
    await expect(page.getByText('No posts yet.')).toBeVisible()
  },
  'home, loading': async ({ page }) => {
    // The pending screen replaces a navigation that takes longer than a second.
    await visit(page, '/about')
    await page.route('**/api/posts', () => {})
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: APP_NAME }).click()
    await expect(page.getByText('Loading…')).toBeVisible()
  },
  'home, system dark theme': async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await visit(page, '/')
  },
  'home, flash message after signing out': async ({ page, author }) => {
    await signIn(page, author)
    await visit(page, '/dashboard')
    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page.getByTestId('flash')).toHaveText('You are signed out.')
  },
  about: ({ page }) => visit(page, '/about'),
  login: ({ page }) => visit(page, '/login'),
  'login, failed sign-in': async ({ page }) => {
    await visit(page, '/login')
    await page.getByRole('textbox', { name: 'Email', exact: true }).fill('nobody@example.test')
    await page.getByLabel('Password').fill('not the password at all')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('alert')).toBeVisible()
  },
  'dashboard with posts': async ({ page, author }) => {
    await dashboardWithMyPost(page, author)
  },
  'dashboard, no posts yet': async ({ page, author }) => {
    await signIn(page, author)
    await navigateWithApiResponse(page, '/api/me/posts', { json: lastPage() })
    await expect(page.getByText('You have not published anything yet.')).toBeVisible()
  },
  'dashboard, composer over the limit': async ({ page, author }) => {
    await signIn(page, author)
    await visit(page, '/dashboard')
    await page.getByLabel('New post').fill(overTheLimit)
    await expect(page.getByText('Over the 280-character limit.')).toBeAttached()
  },
  'dashboard, publish rejected': async ({ page, author }) => {
    await signIn(page, author)
    await visit(page, '/dashboard')
    await page.getByLabel('New post').fill(overTheLimit)
    await page.getByRole('button', { name: 'Publish' }).click()
    await expect(page.getByRole('alert')).toContainText('Use at most 280 characters')
  },
  'dashboard, editing a post': async ({ page, author }) => {
    const { edit } = await dashboardWithMyPost(page, author)
    await edit.click()
    await expect(page.getByLabel('Edit post')).toBeFocused()
  },
  'dashboard, save rejected': async ({ page, author }) => {
    const { edit } = await dashboardWithMyPost(page, author)
    await edit.click()
    await page.getByLabel('Edit post').fill(overTheLimit)
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('alert')).toContainText('Use at most 280 characters')
  },
  'dashboard, dark theme chosen': async ({ page, author }) => {
    await dashboardWithMyPost(page, author)
    await page.getByRole('radio', { name: 'Dark' }).check()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  },
  'dashboard, delete dialog open': async ({ page, author }) => {
    const { post } = await dashboardWithMyPost(page, author)
    await post.getByRole('button', { name: /^Delete post/ }).click()
    await expect(page.getByRole('alertdialog', { name: 'Delete this post?' })).toBeVisible()
  },
  'dashboard, sign-out failed': async ({ page, author }) => {
    await signIn(page, author)
    await visit(page, '/dashboard')
    await failServerFunctionPosts(page)
    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page.getByRole('alert')).toContainText('Could not sign out')
  },
  'sign-up': ({ page }) => visit(page, '/sign-up'),
  'sign-up, sent': async ({ page }) => {
    await visit(page, '/sign-up')
    await page.getByLabel('Name').fill('A11y Account')
    await page.getByRole('textbox', { name: 'Email', exact: true }).fill(`a11y-${crypto.randomUUID()}@example.test`)
    await page.getByLabel('Password').fill(`pw-${crypto.randomUUID()}`)
    await page.getByRole('button', { name: 'Create account' }).click()
    await expect(page.getByRole('status')).toContainText('Check your inbox')
  },
  'forgot password': ({ page }) => visit(page, '/forgot-password'),
  'reset password, no link': async ({ page }) => {
    await visit(page, '/reset-password')
    await expect(page.getByRole('link', { name: 'Ask for a new one' })).toBeVisible()
  },
  'reset password, invalid link': async ({ page }) => {
    await visit(page, '/reset-password?token=not-a-token')
    await page.getByLabel('New password').fill(`pw-${crypto.randomUUID()}`)
    await page.getByRole('button', { name: 'Set new password' }).click()
    await expect(page.getByRole('alert')).toContainText('This link is invalid or has expired')
  },
  'verify email, link': async ({ page }) => {
    await visit(page, '/verify-email?token=not-a-token')
    await expect(page.getByRole('button', { name: 'Confirm email' })).toBeEnabled()
  },
  'verify email, invalid link': async ({ page }) => {
    await visit(page, '/verify-email?token=not-a-token')
    await page.getByRole('button', { name: 'Confirm email' }).click()
    await expect(page.getByRole('alert')).toContainText('This link is invalid or has expired')
  },
  account: async ({ page, author }) => {
    await signIn(page, author)
    await visit(page, '/account')
    await expect(page.getByTestId('sessions').getByRole('listitem')).not.toHaveCount(0)
  },
  'account, wrong current password': async ({ page, author }) => {
    await signIn(page, author)
    await visit(page, '/account')
    await page.getByLabel('Current password').fill('not the password at all')
    await page.getByLabel('New password').fill(`pw-${crypto.randomUUID()}`)
    await page.getByRole('button', { name: 'Change password' }).click()
    await expect(page.getByLabel('Current password')).toHaveAttribute('aria-invalid', 'true')
  },
  'not found': async ({ page }) => {
    await visit(page, '/no-such-page')
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
  },
  'error page': async ({ page }) => {
    await navigateWithApiResponse(page, '/api/posts', {
      status: 503,
      json: { _tag: 'ServiceUnavailable', message: 'Database unavailable' },
    })
    await expect(page.getByRole('heading', { name: 'This page could not be loaded' })).toBeVisible()
  },
}

test.describe('axe', () => {
  for (const [state, reach] of Object.entries(STATES)) {
    test(state, async ({ page, request, author }) => {
      await reach({ page, request, author })
      await expectAccessible(page, state)
    })
  }
})
