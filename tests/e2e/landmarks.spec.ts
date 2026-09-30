// The landmark structure and headings of every page, and of the UI states that change it, as ARIA snapshots.
// scripts/route-coverage.ts requires one for every page route in the `landmarks` block.
//
// The snapshots are partial (Playwright's default matching): each listed node must be there, in this order and at
// this depth, and anything not listed may come between them. So a snapshot lists the page frame (skip link, banner
// with the main navigation, main, and the footer where the state changes it) and what the page's main owns: its
// headings, regions, forms and lists, not what goes inside a list item. A feature that adds a section to a page (a
// comment list under each post) then breaks no snapshot, and one that restructures what is listed does. The price is
// that an unexpected extra landmark passes here; axe (a11y.spec.ts) still fails on content outside the landmarks
// and on landmarks that are not unique.
import { SITE_FOOTER, siteHeader } from './support/a11y.ts'
import {
  dashboardWithMyPost,
  expect,
  fakePost,
  lastPage,
  navigateWithApiResponse,
  signIn,
  test,
  visit,
} from './support/app.ts'

test.describe('landmarks', () => {
  test('home', async ({ page }) => {
    await visit(page, '/')
    await expect(page.locator('body')).toMatchAriaSnapshot(`${siteHeader('signed out')}
- main:
  - heading "Latest posts" [level=1]
${SITE_FOOTER}`)
  })

  test('about', async ({ page }) => {
    // Prerendered, so the header asks who is signed in after hydration (useSessionUser).
    await visit(page, '/about')
    await expect(page.locator('body')).toMatchAriaSnapshot(`${siteHeader('signed out')}
- main:
  - heading "About" [level=1]
  - paragraph`)
  })

  test('login', async ({ page }) => {
    await visit(page, '/login')
    await expect(page.locator('body')).toMatchAriaSnapshot(`${siteHeader('signed out')}
- main:
  - heading "Sign in" [level=1]
  - text: Email
  - textbox "Email"
  - text: Password
  - textbox "Password"
  - button "Sign in"`)
  })

  test('sign-up', async ({ page }) => {
    await visit(page, '/sign-up')
    await expect(page.locator('body')).toMatchAriaSnapshot(`${siteHeader('signed out')}
- main:
  - heading "Create an account" [level=1]
  - textbox "Name"
  - textbox "Email"
  - textbox "Password"
  - button "Create account"`)
  })

  test('forgot password', async ({ page }) => {
    await visit(page, '/forgot-password')
    await expect(page.locator('body')).toMatchAriaSnapshot(`${siteHeader('signed out')}
- main:
  - heading "Forgot your password?" [level=1]
  - textbox "Email"
  - button "Send reset link"`)
  })

  test('reset password', async ({ page }) => {
    await visit(page, '/reset-password?token=not-a-token')
    await expect(page.locator('body')).toMatchAriaSnapshot(`${siteHeader('signed out')}
- main:
  - heading "Choose a new password" [level=1]
  - textbox "New password"
  - button "Set new password"`)
  })

  test('reset password, no link', async ({ page }) => {
    await visit(page, '/reset-password')
    await expect(page.locator('body')).toMatchAriaSnapshot(`${siteHeader('signed out')}
- main:
  - heading "Choose a new password" [level=1]
  - paragraph:
    - link "Ask for a new one"`)
  })

  test('verify email', async ({ page }) => {
    await visit(page, '/verify-email?token=not-a-token')
    await expect(page.locator('body')).toMatchAriaSnapshot(`${siteHeader('signed out')}
- main:
  - heading "Confirm your email" [level=1]
  - paragraph
  - button "Confirm email"`)
  })

  test('account', async ({ page, author }) => {
    await signIn(page, author)
    await visit(page, '/account')
    await expect(page.locator('body')).toMatchAriaSnapshot(`${siteHeader('signed in')}
- main:
  - heading "Account" [level=1]
  - region "Password":
    - heading "Password" [level=2]
  - region "Sessions":
    - heading "Sessions" [level=2]
    - list "Active sessions"
  - region "Delete account":
    - heading "Delete account" [level=2]`)
  })

  test('dashboard', async ({ page, author }) => {
    await signIn(page, author)
    await navigateWithApiResponse(page, '/api/me/posts', { json: lastPage(fakePost('One of mine')) })
    await expect(page.getByText('One of mine', { exact: true })).toBeVisible()
    await expect(page.locator('body')).toMatchAriaSnapshot(`${siteHeader('signed in')}
- main:
  - heading "Your posts" [level=1]
  - text: New post
  - textbox "New post"
  - button "Publish" [disabled]
  - region "Published":
    - heading "Published" [level=2]
    - list:
      - listitem
  - status`)
  })

  test('not found', async ({ page }) => {
    await visit(page, '/no-such-page')
    await expect(page.locator('body')).toMatchAriaSnapshot(`${siteHeader('signed out')}
- main:
  - heading "Page not found" [level=1]
  - link "Go to the home page"`)
  })

  test('error page', async ({ page, author }) => {
    await signIn(page, author)
    await navigateWithApiResponse(page, '/api/posts', { status: 503, json: {} })
    await expect(page.locator('body')).toMatchAriaSnapshot(`${siteHeader('signed in')}
- main:
  - heading [level=1]
  - alert
  - button "Try again"
  - link "Go to the home page"`)
  })
})

// The UI states beyond a page's first render: a flash message, the dark theme, an open dialog.
test.describe('landmarks of UI states', () => {
  test('home, flash message after signing out', async ({ page, author }) => {
    await signIn(page, author)
    await visit(page, '/dashboard')
    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page.locator('body')).toMatchAriaSnapshot(`${siteHeader('signed out')}
- main:
  - heading "Latest posts" [level=1]
  - paragraph: You are signed out.`)
  })

  test('home, system dark theme', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await visit(page, '/')
    await expect(page.locator('body')).toMatchAriaSnapshot(`${siteHeader('signed out')}
- main:
  - heading "Latest posts" [level=1]
- contentinfo:
  - group "Theme":
    - radio "System" [checked]`)
  })

  test('dashboard, delete dialog open', async ({ page, author }) => {
    const { post } = await dashboardWithMyPost(page, author)
    await post.getByRole('button', { name: /^Delete post/ }).click()
    await expect(page.locator('body')).toMatchAriaSnapshot(`
- alertdialog "Delete this post?":
  - heading "Delete this post?" [level=2]
  - paragraph: It will be gone for good, from your posts and from the public list.
  - blockquote: /^a11y post /
  - button "Keep it"
  - button "Delete"`)
  })

  test('dashboard, dark theme chosen', async ({ page, author }) => {
    await signIn(page, author)
    await visit(page, '/dashboard')
    await page.getByRole('radio', { name: 'Dark' }).check()
    await expect(page.locator('body')).toMatchAriaSnapshot(`${siteHeader('signed in')}
- main:
  - heading "Your posts" [level=1]
${SITE_FOOTER.replace('radio "Dark"', 'radio "Dark" [checked]')}`)
  })
})
