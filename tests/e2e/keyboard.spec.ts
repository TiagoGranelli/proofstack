// Keyboard use: Tab reaches every control in reading order with a visible focus indicator and then goes
// past the page's last control (no trap, see `tabThrough`); editing works from the keyboard and puts focus
// back; alerts and status messages appear where the design says. Pointer-free, so skipped on touch projects.
import type { Page } from '@playwright/test'
import { APP_NAME } from '#/config/app.ts'
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

// Every page starts with the skip link and the header, whose account links depend on the session, and ends with
// the footer's theme choice: one Tab stop for the radio group, on its checked radio.
const NAV = ['link "Skip to content"', `link "${APP_NAME}"`, 'link "About"']
const SIGNED_OUT = [...NAV, 'link "Sign in"']
const SIGNED_IN = [...NAV, 'link "Dashboard"', 'link "Account"', 'button "Sign out"']
const FOOTER = ['radio "System"']

// Links are Tab stops in every engine here. Safari leaves them out by default ("Press Tab to highlight each item"),
// but Playwright's WebKit 1.63 includes them, as `pnpm ci:local verify` showed.

test.describe('tab order', () => {
  const pages: Array<[string, (page: Page, author: Author) => Promise<unknown>, string[]]> = [
    // The seed project publishes more than a page of posts (seed.setup.ts), so `/` always ends in Load more.
    ['home', (page) => visit(page, '/'), [...SIGNED_OUT, 'button "Load more posts"', ...FOOTER]],
    [
      'home, flash message after signing out',
      async (page, author) => {
        await signIn(page, author)
        await visit(page, '/dashboard')
        await page.getByRole('button', { name: 'Sign out' }).click()
        await expect(page.getByTestId('flash')).toBeVisible()
      },
      [...SIGNED_OUT, 'button "Load more posts"', ...FOOTER],
    ],
    [
      'about',
      // Prerendered: the header asks who is signed in once hydrated, and shows Dashboard until it knows.
      async (page) => {
        await visit(page, '/about')
        await expect(
          page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Sign in' }),
        ).toBeVisible()
      },
      [...SIGNED_OUT, ...FOOTER],
    ],
    [
      'login',
      (page) => visit(page, '/login'),
      // The open server (APP_URL) has open sign-up, so the page links to it.
      [
        ...SIGNED_OUT,
        'textbox "Email"',
        'textbox "Password"',
        'button "Sign in"',
        'link "Forgot your password?"',
        'link "Create one"',
        ...FOOTER,
      ],
    ],
    [
      'sign-up',
      (page) => visit(page, '/sign-up'),
      [
        ...SIGNED_OUT,
        'textbox "Name"',
        'textbox "Email"',
        'textbox "Password"',
        'button "Create account"',
        'link "Sign in"',
        ...FOOTER,
      ],
    ],
    [
      'forgot password',
      (page) => visit(page, '/forgot-password'),
      [...SIGNED_OUT, 'textbox "Email"', 'button "Send reset link"', 'link "Back to sign in"', ...FOOTER],
    ],
    [
      'reset password',
      (page) => visit(page, '/reset-password?token=not-a-token'),
      [...SIGNED_OUT, 'textbox "New password"', 'button "Set new password"', ...FOOTER],
    ],
    [
      'reset password, no link',
      (page) => visit(page, '/reset-password'),
      [...SIGNED_OUT, 'link "Ask for a new one"', ...FOOTER],
    ],
    [
      'verify email',
      (page) => visit(page, '/verify-email?token=not-a-token'),
      [...SIGNED_OUT, 'button "Confirm email"', ...FOOTER],
    ],
    [
      'account',
      // A new account, so this browser holds its only session and the list has no Sign out buttons.
      async (page) => {
        await signIn(page, await createAccount())
        await visit(page, '/account')
      },
      [
        ...SIGNED_IN,
        'textbox "Current password"',
        'textbox "New password"',
        'button "Change password"',
        // Sign out other sessions is disabled without other sessions.
        'button "Sign out everywhere"',
        'textbox "Password"',
        'checkbox "I understand that my account and all its data are deleted for good."',
        'button "Delete account"',
        ...FOOTER,
      ],
    ],
    ['not found', (page) => visit(page, '/no-such-page'), [...SIGNED_OUT, 'link "Go to the home page"', ...FOOTER]],
    [
      'error page',
      async (page, author) => {
        await signIn(page, author)
        await navigateWithApiResponse(page, '/api/posts', { status: 503, json: {} })
        await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
      },
      [...SIGNED_IN, 'button "Try again"', 'link "Go to the home page"', ...FOOTER],
    ],
    [
      'dashboard',
      async (page, author) => {
        await signIn(page, author)
        await navigateWithApiResponse(page, '/api/me/posts', { json: lastPage(fakePost('First'), fakePost('Second')) })
        await expect(page.getByText('Second', { exact: true })).toBeVisible()
      },
      [
        ...SIGNED_IN,
        'textbox "New post"',
        // Publish is disabled until there is text, so it is not a Tab stop yet.
        'button "Edit post: First"',
        'button "Delete post: First"',
        'button "Edit post: Second"',
        'button "Delete post: Second"',
        ...FOOTER,
      ],
    ],
    [
      'dashboard, dark theme chosen',
      async (page, author) => {
        await signIn(page, author)
        await navigateWithApiResponse(page, '/api/me/posts', { json: lastPage(fakePost('First')) })
        await page.getByRole('radio', { name: 'Dark' }).check()
      },
      [...SIGNED_IN, 'textbox "New post"', 'button "Edit post: First"', 'button "Delete post: First"', 'radio "Dark"'],
    ],
  ]

  for (const [name, reach, expected] of pages) {
    test(`${name}: every control, in order, with visible focus, then past the last one`, async ({ page, author }) => {
      await reach(page, author)
      const stops = await tabOrder(page)
      expect(stops.map((stop) => stop.name)).toEqual(expected)
      expect(stops.filter((stop) => !stop.visibleFocus).map((stop) => stop.name)).toEqual([])
    })
  }

  test('Shift+Tab walks the same stops backwards and past the first one', async ({ page }) => {
    await visit(page, '/login')
    await page.getByRole('button', { name: 'Sign in' }).focus()
    const stops = await tabThrough(page, { backwards: true })
    expect(stops.map((stop) => stop.name)).toEqual([
      'textbox "Password"',
      'textbox "Email"',
      ...SIGNED_OUT.toReversed(),
    ])
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
      ...FOOTER,
    ])
    expect(stops.filter((stop) => !stop.visibleFocus)).toEqual([])
  })

  test('Save from the keyboard announces it and returns focus to Edit', async ({ page, author }) => {
    const { body, edit } = await dashboardWithMyPost(page, author)
    await edit.focus()
    await page.keyboard.press('Enter')
    // The editor loads on demand (from the focus on Edit): type once it has the caret, as a user would.
    await expect(page.getByLabel('Edit post')).toBeFocused()
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
    await expect(alert).toContainText('Use at most 280 characters')
    await expect(field).toHaveAttribute('aria-invalid', 'true')
    await expect(field).toHaveAccessibleDescription(/Over the 280-character limit\..*Use at most 280 characters/)
    // Refused before sending, and focus is on the draft to fix.
    await expect(field).toBeFocused()
  })
})

test.describe('announcements', () => {
  test('publishing is announced and puts focus back in the empty composer', async ({ page, author }) => {
    await dashboardWithMyPost(page, author)
    await expect(page.getByRole('status')).toHaveText('Post published.')
    await expect(page.getByLabel('New post')).toBeFocused()
    await expect(page.getByLabel('New post')).toHaveValue('')
  })

  test('deleting asks first, is announced, and then moves focus to the list heading', async ({ page, author }) => {
    const { post } = await dashboardWithMyPost(page, author)
    await post.getByRole('button', { name: /^Delete post/ }).focus()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('alertdialog', { name: 'Delete this post?' })
    await expect(dialog.getByRole('button', { name: 'Keep it' })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(dialog.getByRole('button', { name: 'Delete', exact: true })).toBeFocused()
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

test.describe('dialogs', () => {
  test('the delete dialog keeps Tab inside it; Escape closes it and puts focus back on Delete', async ({
    page,
    author,
  }) => {
    // A document of its own: the dialog's scroll lock needs the SSR page's nonce (not /about's hash policy).
    const { post } = await dashboardWithMyPost(page, author)
    const remove = post.getByRole('button', { name: /^Delete post/ })
    await remove.focus()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('alertdialog', { name: 'Delete this post?' })
    // The dialog loads on demand: it opens with focus on Keep it.
    await expect(dialog.getByRole('button', { name: 'Keep it' })).toBeFocused()
    const stops: string[] = []
    for (let press = 0; press < 3; press++) {
      await page.keyboard.press('Tab')
      stops.push((await page.locator(':focus').textContent()) ?? '')
    }
    // A modal dialog is the one deliberate trap: focus cycles through its own buttons.
    expect(stops).toEqual(['Delete', 'Keep it', 'Delete'])
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(remove).toBeFocused()
  })
})
