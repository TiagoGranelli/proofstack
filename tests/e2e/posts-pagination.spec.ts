import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

// Acts as the second test author, whose dashboard no other E2E file uses, so the list sizes below are ours to
// assert. Their posts also appear on `/`: they are published once, before the tests, so they are older than
// anything another file publishes meanwhile and never push its posts off the first page.
const other = { email: process.env.TEST_OTHER_USER_EMAIL!, password: process.env.TEST_OTHER_USER_PASSWORD! }
const PAGE_SIZE = 20
const POSTS = 25

let clientCount = 0
const nextIp = (workerIndex: number) => `198.19.${workerIndex % 256}.${++clientCount}`

let api: APIRequestContext
const published: string[] = []

test.beforeAll(async ({ playwright }, testInfo) => {
  const baseURL = process.env.APP_URL!
  api = await playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: { origin: baseURL, 'x-forwarded-for': nextIp(testInfo.workerIndex) },
  })
  expect((await api.post('/api/auth/sign-in/email', { data: other })).status()).toBe(200)
  const tag = `e2e page ${Date.now()}`
  for (let i = 0; i < POSTS; i++) {
    // Sequential, so the creation order is the list order.
    const res = await api.post('/api/me/posts', { data: { body: `${tag} #${i}` } })
    expect(res.status()).toBe(201)
    published.push(((await res.json()) as { id: string }).id)
  }
})

test.afterAll(async () => {
  await Promise.all(published.map((id) => api.delete(`/api/me/posts/${id}`)))
  await api.dispose()
})

test.beforeEach(async ({ context }, testInfo) => {
  await context.setExtraHTTPHeaders({ 'x-forwarded-for': nextIp(testInfo.workerIndex) })
})

const visit = async (page: Page, path: string) => {
  await page.goto(path)
  await expect(page.locator('body[data-hydrated="true"]')).toBeAttached()
}

/** A page of the public list requested from the browser (the first page comes with the HTML). */
const publicListRequest = (url: URL) => url.pathname === '/api/posts'

const items = (page: Page, testId: string) => page.getByTestId(testId).locator(':scope > li')

/** Activates Load more from the keyboard and checks where focus lands and that nothing repeats. */
const loadMoreWithKeyboard = async (page: Page, testId: string, key: 'Enter' | ' ') => {
  const before = await items(page, testId).count()
  const button = page.getByRole('button', { name: 'Load more posts' })
  await button.focus()
  await page.keyboard.press(key)
  // Focus moves to the first post of the new page, so reading continues where the new posts start.
  await expect(items(page, testId).nth(before)).toBeFocused()
  const texts = await items(page, testId).allTextContents()
  expect(texts.length).toBeGreaterThan(before)
  expect(texts.length).toBeLessThanOrEqual(before + PAGE_SIZE)
  expect(new Set(texts).size).toBe(texts.length)
}

test('the dashboard renders the first page on the server and loads the rest with Load more', async ({
  page,
  baseURL,
}) => {
  expect(
    (await page.request.post('/api/auth/sign-in/email', { data: other, headers: { origin: baseURL! } })).status(),
  ).toBe(200)
  const listRequests: string[] = []
  page.on('request', (r) => new URL(r.url()).pathname === '/api/me/posts' && listRequests.push(r.url()))
  await visit(page, '/dashboard')
  await expect(items(page, 'my-posts')).toHaveCount(PAGE_SIZE)
  // The first page came with the HTML: nothing is fetched until the author asks for more.
  await page.waitForLoadState('networkidle')
  expect(listRequests).toEqual([])

  await loadMoreWithKeyboard(page, 'my-posts', 'Enter')
  expect(listRequests).toHaveLength(1)
  expect(new URL(listRequests[0]!).searchParams.get('cursor')).toEqual(expect.any(String))
  // Tab continues inside the focused post, at its first control.
  const focused = items(page, 'my-posts').nth(PAGE_SIZE)
  await page.keyboard.press('Tab')
  await expect(focused.getByRole('button', { name: /^Edit/ })).toBeFocused()

  // Space works too; the button goes away once the last page is in, and focus is not lost with it.
  while (await page.getByRole('button', { name: 'Load more posts' }).isVisible())
    await loadMoreWithKeyboard(page, 'my-posts', ' ')
  await expect(page.locator(':focus')).toHaveCount(1)
  const bodies = await page.getByTestId('my-posts').locator('p').allTextContents()
  expect(bodies.filter((body) => body.startsWith('e2e page ')).length).toBeGreaterThanOrEqual(POSTS)
})

test('the public list loads more posts after the first page, without repeating any', async ({ page }) => {
  await visit(page, '/')
  await expect(items(page, 'public-posts')).toHaveCount(PAGE_SIZE)
  await loadMoreWithKeyboard(page, 'public-posts', 'Enter')
})

test('a failed Load more says so, keeps focus on the button and can be retried', async ({ page }) => {
  await visit(page, '/')
  await page.route(publicListRequest, (route) => route.abort())
  const button = page.getByRole('button', { name: 'Load more posts' })
  await button.focus()
  await page.keyboard.press('Enter')
  // The query retries three times with backoff before it reports the error.
  await expect(page.getByRole('alert')).toContainText('Could not load more posts', { timeout: 15_000 })
  await expect(button).toBeFocused()
  await page.unroute(publicListRequest)
  await page.keyboard.press('Enter')
  await expect(items(page, 'public-posts').nth(PAGE_SIZE)).toBeFocused()
  await expect(page.getByRole('alert')).toHaveCount(0)
})
