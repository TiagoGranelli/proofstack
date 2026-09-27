// axe (WCAG 2.2 AA + best practices) on every page and UI state the app has, and the landmark structure
// of each page as an ARIA snapshot. To cover a new page or state, add one entry to STATES: a name and the
// steps that reach it (helpers in ./support/app.ts).
import type { Page } from '@playwright/test'
import { expectAccessible, SITE_HEADER } from './support/a11y.ts'
import {
  dashboardWithMyPost,
  expect,
  fakePost,
  navigateWithApiResponse,
  overTheLimit,
  seedPost,
  signIn,
  test,
  visit,
} from './support/app.ts'

type Fixtures = { page: Page; request: Parameters<typeof seedPost>[0] }

const STATES: Record<string, (fixtures: Fixtures) => Promise<unknown>> = {
  'home with posts': async ({ page, request }) => {
    await seedPost(request)
    await visit(page, '/')
    await expect(page.getByTestId('public-posts').locator('li').first()).toBeVisible()
  },
  'home, no posts yet': async ({ page }) => {
    await navigateWithApiResponse(page, 'ProofStack', '/api/posts', { json: [] })
    await expect(page.getByText('No posts yet.')).toBeVisible()
  },
  'home, loading': async ({ page }) => {
    // The pending screen replaces a navigation that takes longer than a second.
    await visit(page, '/about')
    await page.route('**/api/posts', () => {})
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'ProofStack' }).click()
    await expect(page.getByText('Loading…')).toBeVisible()
  },
  about: ({ page }) => visit(page, '/about'),
  login: ({ page }) => visit(page, '/login'),
  'login, failed sign-in': async ({ page }) => {
    await visit(page, '/login')
    await page.getByLabel('Email').fill('nobody@example.test')
    await page.getByLabel('Password').fill('not the password at all')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('alert')).toBeVisible()
  },
  'dashboard with posts': async ({ page }) => {
    await dashboardWithMyPost(page)
  },
  'dashboard, no posts yet': async ({ page }) => {
    await signIn(page)
    await navigateWithApiResponse(page, 'Dashboard', '/api/me/posts', { json: [] })
    await expect(page.getByText('You have not published anything yet.')).toBeVisible()
  },
  'dashboard, composer over the limit': async ({ page }) => {
    await signIn(page)
    await visit(page, '/dashboard')
    await page.getByLabel('New post').fill(overTheLimit)
    await expect(page.getByText('Over the 280-character limit.')).toBeAttached()
  },
  'dashboard, publish rejected': async ({ page }) => {
    await signIn(page)
    await visit(page, '/dashboard')
    await page.getByLabel('New post').fill(overTheLimit)
    await page.getByRole('button', { name: 'Publish' }).click()
    await expect(page.getByRole('alert')).toContainText('Could not publish the post')
  },
  'dashboard, editing a post': async ({ page }) => {
    const { edit } = await dashboardWithMyPost(page)
    await edit.click()
    await expect(page.getByLabel('Edit post')).toBeFocused()
  },
  'dashboard, save rejected': async ({ page }) => {
    const { edit } = await dashboardWithMyPost(page)
    await edit.click()
    await page.getByLabel('Edit post').fill(overTheLimit)
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('alert')).toContainText('Could not save the post')
  },
  'dashboard, sign-out failed': async ({ page }) => {
    await signIn(page)
    await visit(page, '/dashboard')
    await page.route('**/api/auth/sign-out', (route) => route.abort())
    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page.getByRole('alert')).toContainText('Could not sign out')
  },
  'not found': async ({ page }) => {
    await visit(page, '/no-such-page')
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
  },
  'error page': async ({ page }) => {
    await navigateWithApiResponse(page, 'ProofStack', '/api/posts', {
      status: 503,
      json: { _tag: 'ServiceUnavailable', message: 'Database unavailable' },
    })
    await expect(page.getByRole('heading', { name: 'This page could not be loaded' })).toBeVisible()
  },
}

test.describe('axe', () => {
  for (const [state, reach] of Object.entries(STATES)) {
    test(state, async ({ page, request }) => {
      await reach({ page, request })
      await expectAccessible(page, state)
    })
  }
})

// Landmarks and headings per page. Partial snapshots: only what is listed is checked, in order.
test.describe('landmarks', () => {
  test('home', async ({ page }) => {
    await visit(page, '/')
    await expect(page.locator('body')).toMatchAriaSnapshot(`${SITE_HEADER}
- main:
  - heading "Latest posts" [level=1]`)
  })

  test('about', async ({ page }) => {
    await visit(page, '/about')
    await expect(page.locator('body')).toMatchAriaSnapshot(`${SITE_HEADER}
- main:
  - heading "About" [level=1]
  - paragraph`)
  })

  test('login', async ({ page }) => {
    await visit(page, '/login')
    await expect(page.locator('body')).toMatchAriaSnapshot(`${SITE_HEADER}
- main:
  - heading "Sign in" [level=1]
  - text: Email
  - textbox "Email"
  - text: Password
  - textbox "Password"
  - button "Sign in"`)
  })

  test('dashboard', async ({ page }) => {
    await signIn(page)
    await navigateWithApiResponse(page, 'Dashboard', '/api/me/posts', { json: [fakePost('One of mine')] })
    await expect(page.getByText('One of mine', { exact: true })).toBeVisible()
    await expect(page.locator('body')).toMatchAriaSnapshot(`${SITE_HEADER}
- main:
  - heading /'s posts$/ [level=1]
  - button "Sign out"
  - text: New post
  - textbox "New post"
  - button "Publish" [disabled]
  - region "Published":
    - heading "Published" [level=2]
    - list:
      - listitem:
        - paragraph: One of mine
        - 'button "Edit post: One of mine"'
        - 'button "Delete post: One of mine"'
  - status`)
  })

  test('not found', async ({ page }) => {
    await visit(page, '/no-such-page')
    await expect(page.locator('body')).toMatchAriaSnapshot(`${SITE_HEADER}
- main:
  - heading "Page not found" [level=1]
  - link "Go to latest posts"`)
  })

  test('error page', async ({ page }) => {
    await navigateWithApiResponse(page, 'ProofStack', '/api/posts', { status: 503, json: {} })
    await expect(page.locator('body')).toMatchAriaSnapshot(`${SITE_HEADER}
- main:
  - heading "This page could not be loaded" [level=1]
  - alert
  - button "Try again"
  - link "Go to latest posts"`)
  })
})
