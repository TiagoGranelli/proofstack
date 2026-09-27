import type { Page } from '@playwright/test'
import { APP_NAME } from '#/config/app.ts'
import { signInWithForm } from './support/accounts.ts'
import { type Author, expect, failServerFunctionPosts, signIn, test, visit } from './support/app.ts'

/**
 * On the dashboard, hydrated and rendered. Leaving a page before that (a `goto`, cleared cookies) races with
 * it: the URL changes before the route's session check and loader finish, and after a server redirect the
 * SSR HTML is there while its route chunks still load. A new navigation aborts those chunks, TanStack Router
 * reloads the page on a failed chunk, and that reload aborts the `goto` (Firefox: NS_BINDING_ABORTED).
 */
const expectDashboard = async (page: Page) => {
  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(page.locator('body[data-hydrated="true"]')).toBeAttached()
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
}

const exactly = (text: string) => new RegExp(`^${text.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
/** One of my posts, by its exact body (the body paragraph is replaced by the form while editing). */
const myPost = (page: Page, body: string) =>
  page
    .getByTestId('my-posts')
    .locator('li')
    .filter({ has: page.locator('p', { hasText: exactly(body) }) })
/** The post currently being edited. */
const editing = (page: Page) =>
  page
    .getByTestId('my-posts')
    .locator('li')
    .filter({ has: page.getByRole('textbox', { name: 'Edit post' }) })

const publish = async (page: Page, body: string) => {
  await page.getByLabel('New post').fill(body)
  await page.getByRole('button', { name: 'Publish' }).click()
  await expect(myPost(page, body)).toBeVisible()
}

/** Opens the editor of post `body`, types `draft` and saves it. */
const editPost = async (page: Page, body: string, draft: string) => {
  await myPost(page, body).getByRole('button', { name: /^Edit/ }).click()
  await page.getByLabel('Edit post').fill(draft)
  await page.getByRole('button', { name: 'Save' }).click()
}

/** Opens the editor of post `body`, types a draft and leaves with `how`: the original text stays. */
const expectEditDiscarded = async (page: Page, body: string, how: 'the Cancel button' | 'Escape') => {
  await myPost(page, body).getByRole('button', { name: /^Edit/ }).click()
  await expect(page.getByLabel('Edit post')).toHaveValue(body)
  await page.getByLabel('Edit post').fill(`${body} (discarded)`)
  if (how === 'Escape') await page.keyboard.press('Escape')
  else await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByLabel('Edit post')).toHaveCount(0)
  await expect(myPost(page, body)).toBeVisible()
}

/** After a save: the editor closed, `edited` took the place of `body`, and the API stores `edited` alone. */
const expectPostReplaced = async (page: Page, body: string, edited: string) => {
  await expect(page.getByLabel('Edit post')).toHaveCount(0)
  await expect(myPost(page, edited)).toBeVisible()
  await expect(myPost(page, body)).toHaveCount(0)
  const saved = (await (await page.request.get('/api/me/posts')).json()) as { items: Array<{ body: string }> }
  expect(saved.items.filter((post) => post.body.includes(body)).map((post) => post.body)).toEqual([edited])
}

const deletePost = async (page: Page, body: string) => {
  await myPost(page, body)
    .getByRole('button', { name: /^Delete/ })
    .click()
  await expect(myPost(page, body)).toHaveCount(0)
}

const navLink = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name, exact: true })

/**
 * Signs in through the form on /login, and checks what that must never do: put the password in the URL, or let
 * the session check that guards /dashboard (a GET server function) be cached.
 */
const signInThroughForm = async (page: Page, author: Author) => {
  await visit(page, '/login')
  const sessionCheck = page.waitForResponse((r) => r.url().includes('/_serverFn/') && r.request().method() === 'GET')
  await signInWithForm(page, author)
  await expectDashboard(page)
  expect(page.url()).not.toContain('password')
  expect((await sessionCheck).headers()['cache-control']).toContain('no-store')
}

/** Signs out from the dashboard: the app goes home, and /dashboard sends the visitor to sign in. */
const signOutFromDashboard = async (page: Page) => {
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/$/)
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/login\?redirect=%2Fdashboard$/)
}

/** Goes to the dashboard by the main navigation, then hovers the public list's link, so the router preloads it. */
const openDashboardPreloadingHome = async (page: Page) => {
  await navLink(page, 'Dashboard').click()
  await expect(page.getByLabel('New post')).toBeVisible()
  await navLink(page, APP_NAME).hover()
}

type Frames = { publicListFrames?: string[] }
/**
 * From now on, records the text of the public list every time the DOM changes, so a frame that briefly
 * showed the old list cannot go unnoticed (Playwright's retrying assertions only see the final state).
 */
const recordPublicList = (page: Page) =>
  page.evaluate(() => {
    const frames: string[] = []
    ;(window as Frames).publicListFrames = frames
    new MutationObserver(() => {
      const list = document.querySelector('[data-testid="public-posts"]')
      if (list) frames.push(list.textContent)
    }).observe(document.body, { childList: true, subtree: true, characterData: true })
  })
const publicListFrames = (page: Page) => page.evaluate(() => (window as Frames).publicListFrames ?? [])

/**
 * Goes to the public list by the main navigation and expects it to show `body` in every frame it rendered, never
 * the list from before.
 */
const expectHomeShowsOnly = async (page: Page, body: string) => {
  await recordPublicList(page)
  await navLink(page, APP_NAME).click()
  await expect(page.getByTestId('public-posts')).toContainText(body)
  expect((await publicListFrames(page)).filter((text) => !text.includes(body))).toEqual([])
}

test('public page hydrates from SSR without refetching or console errors', async ({ page }) => {
  const apiCalls: string[] = []
  const errors: string[] = []
  page.on('request', (r) => r.url().includes('/api/') && apiCalls.push(r.url()))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await visit(page, '/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await page.waitForLoadState('networkidle')
  expect(apiCalls).toEqual([])
  expect(errors).toEqual([])
})

test('dashboard hydrates from SSR without refetching its data', async ({ page, author }) => {
  await signIn(page, author)
  const refetches: string[] = []
  const errors: string[] = []
  page.on('request', (r) => new URL(r.url()).pathname.startsWith('/api/') && refetches.push(r.url()))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await visit(page, '/dashboard')
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
  await page.waitForLoadState('networkidle')
  expect(refetches).toEqual([])
  expect(errors).toEqual([])
})

test('before hydration, a form never posts credentials to the page itself', async ({ page }) => {
  await page.route('**/assets/**', (route) => route.abort())
  // The login form posts to its server function (ADR 0015), never to /login.
  await page.goto('/login')
  const login = page.locator('form')
  await expect(login).toHaveAttribute('method', 'post')
  await expect(login).toHaveAttribute('action', /^\/_serverFn\/[0-9a-f]+$/)
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeEnabled()
  // A form without an action keeps its button disabled until the scripts run.
  await page.goto('/forgot-password')
  await expect(page.locator('form')).not.toHaveAttribute('action')
  await expect(page.getByRole('button', { name: 'Send reset link' })).toBeDisabled()
})

test('private routes redirect anonymous visitors to login and back after sign-in', async ({ page, author }) => {
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/login\?redirect=%2Fdashboard$/)
  await expect(page.locator('body[data-hydrated="true"]')).toBeAttached()
  await signInWithForm(page, author)
  await expectDashboard(page)
})

test('sign-in follows a same-origin redirect and ignores a foreign one', async ({ page, author }) => {
  await visit(page, '/login?redirect=%2Fabout')
  await signInWithForm(page, author)
  await expect(page).toHaveURL(/\/about$/)
  await expect(page.getByRole('heading', { name: 'About' })).toBeVisible()

  // Signed in: /login goes straight to the dashboard.
  await page.goto('/login')
  await expectDashboard(page)

  await page.context().clearCookies()
  for (const target of ['https://evil.example/', '//evil.example/']) {
    await visit(page, `/login?redirect=${encodeURIComponent(target)}`)
    await signInWithForm(page, author)
    await expectDashboard(page)
    await page.context().clearCookies()
  }
})

test('author signs in, publishes, edits, sees the post publicly, deletes it and signs out', async ({
  page,
  author,
}) => {
  await signInThroughForm(page, author)

  const body = `e2e post ${Date.now()}`
  await publish(page, body)

  // Cancel (button or Escape) keeps the original text.
  await expectEditDiscarded(page, body, 'the Cancel button')
  await expectEditDiscarded(page, body, 'Escape')

  // Save replaces it, and the change is persisted, trimmed (the API rejects untrimmed bodies).
  const edited = `${body} (edited)`
  await editPost(page, body, `  ${edited} \n`)
  await expectPostReplaced(page, body, edited)
  await page.reload()
  await expect(myPost(page, edited)).toBeVisible()

  await visit(page, '/')
  await expect(page.getByTestId('public-posts')).toContainText(edited)

  await visit(page, '/dashboard')
  await deletePost(page, edited)
  await signOutFromDashboard(page)
})

test('a rejected save shows the error in the post and keeps the draft', async ({ page, author }) => {
  await signIn(page, author)
  await visit(page, '/dashboard')
  const body = `e2e rejected edit ${Date.now()}`
  await publish(page, body)
  // Over the 280-character limit: the form refuses it with the API's own rule and stays open with the draft.
  const draft = 'x'.repeat(281)
  await editPost(page, body, draft)
  await expect(editing(page).getByRole('alert')).toContainText('Use at most 280 characters')
  await expect(page.getByLabel('Edit post')).toHaveValue(draft)

  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(myPost(page, body)).toBeVisible()
  await deletePost(page, body)
})

test('client-side navigation shows a post published or edited moments ago, never the old list', async ({
  page,
  author,
}) => {
  await signIn(page, author)
  // The public list is cached in this tab, and hovering the link preloads it again before each write.
  await visit(page, '/')
  await openDashboardPreloadingHome(page)

  const body = `e2e fresh ${Date.now()}`
  await publish(page, body)
  await expectHomeShowsOnly(page, body)

  await openDashboardPreloadingHome(page)
  const edited = `${body} (edited)`
  await editPost(page, body, edited)
  await expect(myPost(page, edited)).toBeVisible()
  await expectHomeShowsOnly(page, edited)

  await navLink(page, 'Dashboard').click()
  await deletePost(page, edited)
})

test('signs in through the form and out again', async ({ page, author }) => {
  await signInThroughForm(page, author)
  await signOutFromDashboard(page)
})

test('a failed sign-out says so and can be retried', async ({ page, author }) => {
  await signIn(page, author)
  await visit(page, '/dashboard')
  // Sign-out is a server function (POST /_serverFn/...).
  const restore = await failServerFunctionPosts(page)
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByRole('alert')).toContainText('Could not sign out')
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeEnabled()
  await restore()
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/$/)
})
