import type { Page } from '@playwright/test'
import { expect, signIn, test, visit, type Author } from './support/app.ts'

const signInWithForm = async (page: Page, author: Author) => {
  await page.getByLabel('Email').fill(author.email)
  await page.getByLabel('Password').fill(author.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

/**
 * On the dashboard, hydrated and rendered. Leaving a page before that (a `goto`, cleared cookies) races with
 * it: the URL changes before the route's session check and loader finish, and after a server redirect the
 * SSR HTML is there while its route chunks still load. A new navigation aborts those chunks, TanStack Router
 * reloads the page on a failed chunk, and that reload aborts the `goto` (Firefox: NS_BINDING_ABORTED).
 */
const expectDashboard = async (page: Page) => {
  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(page.locator('body[data-hydrated="true"]')).toBeAttached()
  await expect(page.getByLabel('New post')).toBeVisible()
}

const exactly = (text: string) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
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

const navLink = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name, exact: true })

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
      if (list) frames.push(list.textContent ?? '')
    }).observe(document.body, { childList: true, subtree: true, characterData: true })
  })
const publicListFrames = (page: Page) => page.evaluate(() => (window as Frames).publicListFrames ?? [])

test('public page hydrates from SSR without refetching or console errors', async ({ page }) => {
  const apiCalls: string[] = []
  const errors: string[] = []
  page.on('request', (r) => r.url().includes('/api/') && apiCalls.push(r.url()))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await visit(page, '/')
  await expect(page.getByRole('heading', { name: 'Latest posts' })).toBeVisible()
  await page.waitForLoadState('networkidle')
  expect(apiCalls).toEqual([])
  expect(errors).toEqual([])
})

test('dashboard hydrates from SSR without refetching my posts', async ({ page, author }) => {
  await signIn(page, author)
  const refetches: string[] = []
  const errors: string[] = []
  page.on('request', (r) => new URL(r.url()).pathname.startsWith('/api/me/posts') && refetches.push(r.url()))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await visit(page, '/dashboard')
  await expect(page.getByLabel('New post')).toBeVisible()
  await page.waitForLoadState('networkidle')
  expect(refetches).toEqual([])
  expect(errors).toEqual([])
})

test('login form never submits credentials before hydration', async ({ page }) => {
  await page.route('**/assets/**', (route) => route.abort())
  await page.goto('/login')
  await expect(page.locator('form')).toHaveAttribute('method', 'post')
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeDisabled()
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
  await visit(page, '/login')
  // The session check that guards /dashboard is a GET server function: it must never be cached.
  const sessionCheck = page.waitForResponse((r) => r.url().includes('/_serverFn/') && r.request().method() === 'GET')
  await signInWithForm(page, author)
  await expect(page).toHaveURL(/\/dashboard$/)
  expect(page.url()).not.toContain('password')
  expect((await sessionCheck).headers()['cache-control']).toContain('no-store')

  const body = `e2e post ${Date.now()}`
  await publish(page, body)

  // Cancel (button or Escape) keeps the original text.
  for (const cancel of [
    () => page.getByRole('button', { name: 'Cancel' }).click(),
    () => page.keyboard.press('Escape'),
  ]) {
    await myPost(page, body).getByRole('button', { name: /^Edit/ }).click()
    await expect(page.getByLabel('Edit post')).toHaveValue(body)
    await page.getByLabel('Edit post').fill(`${body} (discarded)`)
    await cancel()
    await expect(page.getByLabel('Edit post')).toHaveCount(0)
    await expect(myPost(page, body)).toBeVisible()
  }

  // Save replaces it, and the change is persisted, trimmed (the API rejects untrimmed bodies).
  const edited = `${body} (edited)`
  await myPost(page, body).getByRole('button', { name: /^Edit/ }).click()
  await page.getByLabel('Edit post').fill(`  ${edited} \n`)
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByLabel('Edit post')).toHaveCount(0)
  await expect(myPost(page, edited)).toBeVisible()
  await expect(myPost(page, body)).toHaveCount(0)
  const saved = (await (await page.request.get('/api/me/posts')).json()) as { items: Array<{ body: string }> }
  expect(saved.items.filter((post) => post.body.includes(body)).map((post) => post.body)).toEqual([edited])
  await page.reload()
  await expect(myPost(page, edited)).toBeVisible()

  await visit(page, '/')
  await expect(page.getByTestId('public-posts')).toContainText(edited)

  await visit(page, '/dashboard')
  await myPost(page, edited)
    .getByRole('button', { name: /^Delete/ })
    .click()
  await expect(myPost(page, edited)).toHaveCount(0)

  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/$/)
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/login\?redirect=%2Fdashboard$/)
})

test('a rejected save shows the error in the post and keeps the draft', async ({ page, author }) => {
  await signIn(page, author)
  await visit(page, '/dashboard')
  const body = `e2e rejected edit ${Date.now()}`
  await publish(page, body)
  await myPost(page, body).getByRole('button', { name: /^Edit/ }).click()
  // Over the 280-character limit: the server answers 400 and the form stays open with the draft.
  const draft = 'x'.repeat(281)
  await page.getByLabel('Edit post').fill(draft)
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(editing(page).getByRole('alert')).toContainText('Could not save the post')
  await expect(page.getByLabel('Edit post')).toHaveValue(draft)

  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(myPost(page, body)).toBeVisible()
  await myPost(page, body)
    .getByRole('button', { name: /^Delete/ })
    .click()
  await expect(myPost(page, body)).toHaveCount(0)
})

test('client-side navigation shows a post published or edited moments ago, never the old list', async ({
  page,
  author,
}) => {
  await signIn(page, author)
  // The public list is cached in this tab, and hovering the link preloads it again before each write.
  await visit(page, '/')
  await navLink(page, 'Dashboard').click()
  await expect(page.getByLabel('New post')).toBeVisible()
  await navLink(page, 'ProofStack').hover()

  const body = `e2e fresh ${Date.now()}`
  await publish(page, body)
  await recordPublicList(page)
  await navLink(page, 'ProofStack').click()
  await expect(page.getByTestId('public-posts')).toContainText(body)
  expect((await publicListFrames(page)).filter((text) => !text.includes(body))).toEqual([])

  await navLink(page, 'Dashboard').click()
  await navLink(page, 'ProofStack').hover()
  const edited = `${body} (edited)`
  await myPost(page, body).getByRole('button', { name: /^Edit/ }).click()
  await page.getByLabel('Edit post').fill(edited)
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(myPost(page, edited)).toBeVisible()
  await recordPublicList(page)
  await navLink(page, 'ProofStack').click()
  await expect(page.getByTestId('public-posts')).toContainText(edited)
  expect((await publicListFrames(page)).filter((text) => !text.includes(edited))).toEqual([])

  await navLink(page, 'Dashboard').click()
  await myPost(page, edited)
    .getByRole('button', { name: /^Delete/ })
    .click()
  await expect(myPost(page, edited)).toHaveCount(0)
})

test('a failed sign-out says so and can be retried', async ({ page, author }) => {
  await signIn(page, author)
  await visit(page, '/dashboard')
  await page.route('**/api/auth/sign-out', (route) => route.abort())
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByRole('alert')).toContainText('Could not sign out')
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeEnabled()
  await page.unroute('**/api/auth/sign-out')
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/$/)
})
