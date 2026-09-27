// Keyboard use: Tab reaches every control in reading order with a visible focus indicator and then goes
// past the page's last control (no trap, see `tabThrough`); editing works from the keyboard and puts focus
// back; alerts and status messages appear where the design says. Pointer-free, so skipped on touch projects.
import type { Page } from '@playwright/test'
import { tabOrder, tabThrough } from './support/a11y.ts'
import { createAccount } from './support/accounts.ts'
import {
  dashboardWithMyPost,
  expect,
  failServerFunctionPosts,
  fakePost,
  lastPage,
  navigateWithApiResponse,
  signIn,
  test,
  visit,
  type Author,
} from './support/app.ts'

test.skip(({ isMobile }) => isMobile, 'keyboard navigation is a desktop concern')

const NAV = ['link "ProofStack"', 'link "About"', 'link "Dashboard"']

/**
 * WebKit leaves links out of the Tab order by default (Safari's "Press Tab to highlight each item" setting),
 * so its expected stops are the same minus the links.
 */
const tabbable = (browserName: string, stops: string[]) =>
  browserName === 'webkit' ? stops.filter((stop) => !stop.startsWith('link ')) : stops

test.describe('tab order', () => {
  const pages: Array<[string, (page: Page, author: Author) => Promise<unknown>, string[]]> = [
    // The seed project publishes more than a page of posts (seed.setup.ts), so `/` always ends in Load more.
    ['home', (page) => visit(page, '/'), [...NAV, 'button "Load more posts"']],
    ['about', (page) => visit(page, '/about'), NAV],
    [
      'login',
      (page) => visit(page, '/login'),
      // verify:app's APP_URL server has open sign-up, so the page links to it.
      [
        ...NAV,
        'textbox "Email"',
        'textbox "Password"',
        'button "Sign in"',
        'link "Forgot your password?"',
        'link "Create one"',
      ],
    ],
    [
      'sign-up',
      (page) => visit(page, '/sign-up'),
      [...NAV, 'textbox "Name"', 'textbox "Email"', 'textbox "Password"', 'button "Create account"', 'link "Sign in"'],
    ],
    [
      'forgot password',
      (page) => visit(page, '/forgot-password'),
      [...NAV, 'textbox "Email"', 'button "Send reset link"', 'link "Back to sign in"'],
    ],
    [
      'reset password',
      (page) => visit(page, '/reset-password?token=not-a-token'),
      [...NAV, 'textbox "New password"', 'button "Set new password"'],
    ],
    ['reset password, no link', (page) => visit(page, '/reset-password'), [...NAV, 'link "Ask for a new one"']],
    ['verify email', (page) => visit(page, '/verify-email?token=not-a-token'), [...NAV, 'button "Confirm email"']],
    [
      'account',
      // A new account, so this browser holds its only session and the list has no Sign out buttons.
      async (page) => {
        await signIn(page, await createAccount())
        await visit(page, '/account')
      },
      [
        ...NAV,
        'textbox "Current password"',
        'textbox "New password"',
        'button "Change password"',
        // Sign out other sessions is disabled without other sessions.
        'button "Sign out everywhere"',
        'textbox "Password"',
        'checkbox "I understand that my account and all my posts are deleted for good."',
        'button "Delete account"',
      ],
    ],
    ['not found', (page) => visit(page, '/no-such-page'), [...NAV, 'link "Go to latest posts"']],
    [
      'error page',
      (page) => navigateWithApiResponse(page, '/api/posts', { status: 503, json: {} }),
      [...NAV, 'button "Try again"', 'link "Go to latest posts"'],
    ],
    [
      'dashboard',
      async (page, author) => {
        await signIn(page, author)
        await navigateWithApiResponse(page, '/api/me/posts', { json: lastPage(fakePost('First'), fakePost('Second')) })
        await expect(page.getByText('Second', { exact: true })).toBeVisible()
      },
      [
        ...NAV,
        'link "Account"',
        'button "Sign out"',
        'textbox "New post"',
        // Publish is disabled until there is text, so it is not a Tab stop yet.
        'button "Edit post: First"',
        'button "Delete post: First"',
        'button "Edit post: Second"',
        'button "Delete post: Second"',
      ],
    ],
  ]

  for (const [name, reach, expected] of pages) {
    test(`${name}: every control, in order, with visible focus, then past the last one`, async ({
      page,
      author,
      browserName,
    }) => {
      await reach(page, author)
      const stops = await tabOrder(page)
      expect(stops.map((stop) => stop.name)).toEqual(tabbable(browserName, expected))
      expect(stops.filter((stop) => !stop.visibleFocus).map((stop) => stop.name)).toEqual([])
    })
  }

  test('Shift+Tab walks the same stops backwards and past the first one', async ({ page, browserName }) => {
    await visit(page, '/login')
    await page.getByRole('button', { name: 'Sign in' }).focus()
    const stops = await tabThrough(page, { backwards: true })
    expect(stops.map((stop) => stop.name)).toEqual(
      tabbable(browserName, ['textbox "Password"', 'textbox "Email"', ...NAV.toReversed()]),
    )
  })
})

test.describe('editing from the keyboard', () => {
  test('Enter on Edit focuses the draft; Escape cancels and puts focus back on Edit', async ({ page, author }) => {
    const { body, post, edit } = await dashboardWithMyPost(page, author)
    await edit.focus()
    await page.keyboard.press('Enter')
    const field = page.getByLabel('Edit post')
    await expect(field).toBeFocused()
    await page.keyboard.type(' (discarded)')
    await page.keyboard.press('Escape')
    await expect(field).toHaveCount(0)
    await expect(edit).toBeFocused()
    await expect(post.locator('p')).toHaveText(body)
  })

  test('the edit form is not a trap: Tab goes on to Cancel, Save and the rest of the page', async ({
    page,
    author,
  }) => {
    await signIn(page, author)
    await navigateWithApiResponse(page, '/api/me/posts', { json: lastPage(fakePost('First'), fakePost('Second')) })
    await page.getByRole('button', { name: 'Edit post: First' }).click()
    await expect(page.getByLabel('Edit post')).toBeFocused()
    const stops = await tabThrough(page)
    expect(stops.map((stop) => stop.name)).toEqual([
      'button "Cancel"',
      'button "Save"',
      'button "Edit post: Second"',
      'button "Delete post: Second"',
    ])
    expect(stops.filter((stop) => !stop.visibleFocus)).toEqual([])
  })

  test('Save from the keyboard announces it and returns focus to Edit', async ({ page, author }) => {
    const { body, edit } = await dashboardWithMyPost(page, author)
    await edit.focus()
    await page.keyboard.press('Enter')
    await page.keyboard.type(' (saved)')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'Save' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('status')).toHaveText('Post saved.')
    const saved = page
      .getByTestId('my-posts')
      .locator('li')
      .filter({ hasText: `${body} (saved)` })
    await expect(saved.getByRole('button', { name: /^Edit/ })).toBeFocused()
  })

  test('a rejected save is an alert inside the form that also describes the draft', async ({ page, author }) => {
    const { edit } = await dashboardWithMyPost(page, author)
    await edit.click()
    const field = page.getByLabel('Edit post')
    await field.fill('x'.repeat(281))
    await page.getByRole('button', { name: 'Save' }).press('Enter')
    const alert = page.getByRole('alert')
    await expect(alert).toContainText('Could not save the post')
    await expect(field).toHaveAttribute('aria-invalid', 'true')
    await expect(field).toHaveAccessibleDescription(/Over the 280-character limit\..*Could not save the post/)
  })
})

test.describe('announcements', () => {
  test('publishing and deleting are announced; after a delete, focus moves to the list heading', async ({
    page,
    author,
  }) => {
    const { post } = await dashboardWithMyPost(page, author)
    await expect(page.getByRole('status')).toHaveText('Post published.')
    await post.getByRole('button', { name: /^Delete/ }).focus()
    await page.keyboard.press('Enter')
    await expect(post).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Published' })).toBeFocused()
    await expect(page.getByRole('status')).toHaveText('Post deleted.')
  })

  test('a failed sign-in is an alert that describes the form, and focus stays in the form', async ({ page }) => {
    await visit(page, '/login')
    await page.getByRole('textbox', { name: 'Email', exact: true }).fill('nobody@example.test')
    await page.getByLabel('Password').fill('not the password at all')
    await page.keyboard.press('Enter')
    const alert = page.getByRole('alert')
    await expect(alert).toBeVisible()
    await expect(page.locator('form')).toHaveAccessibleDescription(await alert.innerText())
    await expect(page.getByLabel('Password')).toBeFocused()
  })

  test('a failed sign-out is an alert, and the button can be used again from the keyboard', async ({
    page,
    author,
  }) => {
    await signIn(page, author)
    await visit(page, '/dashboard')
    const restore = await failServerFunctionPosts(page)
    const signOut = page.getByRole('button', { name: 'Sign out' })
    await signOut.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('alert')).toHaveText('Could not sign out. Check your connection and try again.')
    await expect(signOut).toBeEnabled()
    await restore()
    await signOut.focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/$/)
  })
})
