// Keyboard use: Tab reaches every control in reading order with a visible focus indicator and then goes
// past the page's last control (no trap, see `tabThrough`); the one deliberate trap is a modal dialog. What an
// action does to focus and what it announces is in keyboard-actions.spec.ts. Pointer-free, so skipped on touch
// projects.
//
// What a tab-order row pins down. Every row walks the whole page, so every stop must show its focus and Tab must
// get past the last one. The order is checked exactly only where the order is the product: the skip link and the
// header come first, and the footer's theme choice comes last, on every page. Between them a row lists the
// controls its state is about, in order, and other stops may come among them. So a feature that adds a section to
// a page (a comment field under each post) breaks no row, of that state or any other. The price: an extra control
// that should not be there passes here, so a control that must not be a Tab stop (a disabled button) goes in
// `never`, and what each control is stays with axe (a11y.spec.ts) and the component tests.
import type { Page } from '@playwright/test'
import { APP_NAME } from '#/config/app.ts'
import { expectTabStops, tabOrder, tabThrough } from './support/a11y.ts'
import { createAccount } from './support/accounts.ts'
import {
  dashboardWithMyPost,
  expect,
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

/** A row: the header the page starts with, its own controls in order, and what must not be a stop. */
type Row = { header: string[]; controls: string[]; never?: string[]; footer?: string[] }

test.describe('tab order', () => {
  const pages: Array<[string, (page: Page, author: Author) => Promise<unknown>, Row]> = [
    // The seed project publishes more than a page of posts (seed.setup.ts), so `/` always ends in Load more.
    ['home', (page) => visit(page, '/'), { header: SIGNED_OUT, controls: ['button "Load more posts"'] }],
    [
      'home, flash message after signing out',
      async (page, author) => {
        await signIn(page, author)
        await visit(page, '/dashboard')
        await page.getByRole('button', { name: 'Sign out' }).click()
        await expect(page.getByTestId('flash')).toBeVisible()
      },
      { header: SIGNED_OUT, controls: ['button "Load more posts"'] },
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
      { header: SIGNED_OUT, controls: [] },
    ],
    [
      'login',
      (page) => visit(page, '/login'),
      // The open server (APP_URL) has open sign-up, so the page links to it.
      {
        header: SIGNED_OUT,
        controls: [
          'textbox "Email"',
          'textbox "Password"',
          'button "Sign in"',
          'link "Forgot your password?"',
          'link "Create one"',
        ],
      },
    ],
    [
      'sign-up',
      (page) => visit(page, '/sign-up'),
      {
        header: SIGNED_OUT,
        controls: [
          'textbox "Name"',
          'textbox "Email"',
          'textbox "Password"',
          'button "Create account"',
          'link "Sign in"',
        ],
      },
    ],
    [
      'forgot password',
      (page) => visit(page, '/forgot-password'),
      { header: SIGNED_OUT, controls: ['textbox "Email"', 'button "Send reset link"', 'link "Back to sign in"'] },
    ],
    [
      'reset password',
      (page) => visit(page, '/reset-password?token=not-a-token'),
      { header: SIGNED_OUT, controls: ['textbox "New password"', 'button "Set new password"'] },
    ],
    [
      'reset password, no link',
      (page) => visit(page, '/reset-password'),
      { header: SIGNED_OUT, controls: ['link "Ask for a new one"'] },
    ],
    [
      'verify email',
      (page) => visit(page, '/verify-email?token=not-a-token'),
      { header: SIGNED_OUT, controls: ['button "Confirm email"'] },
    ],
    [
      'account',
      // A new account, so this browser holds its only session and the list has no Sign out buttons.
      async (page) => {
        await signIn(page, await createAccount())
        await visit(page, '/account')
      },
      {
        header: SIGNED_IN,
        controls: [
          'textbox "Current password"',
          'textbox "New password"',
          'button "Change password"',
          'button "Sign out everywhere"',
          'textbox "Password"',
          'checkbox "I understand that my account and all its data are deleted for good."',
          'button "Delete account"',
        ],
        // Disabled without other sessions.
        never: ['button "Sign out other sessions"'],
      },
    ],
    [
      'not found',
      (page) => visit(page, '/no-such-page'),
      { header: SIGNED_OUT, controls: ['link "Go to the home page"'] },
    ],
    [
      'error page',
      async (page, author) => {
        await signIn(page, author)
        await navigateWithApiResponse(page, '/api/posts', { status: 503, json: {} })
        await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
      },
      { header: SIGNED_IN, controls: ['button "Try again"', 'link "Go to the home page"'] },
    ],
    [
      'dashboard',
      async (page, author) => {
        await signIn(page, author)
        await navigateWithApiResponse(page, '/api/me/posts', { json: lastPage(fakePost('First'), fakePost('Second')) })
        await expect(page.getByText('Second', { exact: true })).toBeVisible()
      },
      {
        header: SIGNED_IN,
        controls: [
          'textbox "New post"',
          'button "Edit post: First"',
          'button "Delete post: First"',
          'button "Edit post: Second"',
          'button "Delete post: Second"',
        ],
        // Disabled until there is text.
        never: ['button "Publish"'],
      },
    ],
    [
      'dashboard, dark theme chosen',
      async (page, author) => {
        await signIn(page, author)
        await navigateWithApiResponse(page, '/api/me/posts', { json: lastPage(fakePost('First')) })
        await page.getByRole('radio', { name: 'Dark' }).check()
      },
      {
        header: SIGNED_IN,
        controls: ['textbox "New post"', 'button "Edit post: First"', 'button "Delete post: First"'],
        footer: ['radio "Dark"'],
      },
    ],
  ]

  for (const [name, reach, row] of pages) {
    test(`${name}: its controls in order, with visible focus, then past the last one`, async ({ page, author }) => {
      await reach(page, author)
      const { header, controls, never, footer = FOOTER } = row
      expectTabStops(await tabOrder(page), { first: header, inOrder: controls, last: footer, never })
    })
  }

  test('Shift+Tab walks the same stops backwards and past the first one', async ({ page }) => {
    await visit(page, '/login')
    await page.getByRole('button', { name: 'Sign in' }).focus()
    const stops = await tabThrough(page, { backwards: true })
    expectTabStops(stops, {
      first: [],
      inOrder: ['textbox "Password"', 'textbox "Email"'],
      last: SIGNED_OUT.toReversed(),
    })
  })
})

test.describe('focus traps', () => {
  test('the edit form is not a trap: Tab goes on to Cancel, Save and the rest of the page', async ({
    page,
    author,
  }) => {
    await signIn(page, author)
    await navigateWithApiResponse(page, '/api/me/posts', { json: lastPage(fakePost('First'), fakePost('Second')) })
    await page.getByRole('button', { name: 'Edit post: First' }).click()
    await expect(page.getByLabel('Edit post')).toBeFocused()
    expectTabStops(await tabThrough(page), {
      first: ['button "Cancel"', 'button "Save"'],
      inOrder: ['button "Edit post: Second"', 'button "Delete post: Second"'],
      last: FOOTER,
    })
  })

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
