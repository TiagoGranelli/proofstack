// Shared by the accessibility and keyboard specs: a `test` whose browser and API contexts each sign in from
// their own client IP, and the steps that bring the app into a given state.
import { test as base, expect, type APIRequestContext, type Page } from '@playwright/test'
import { POST_MAX_LENGTH } from '#/contract/limits.ts'
import type { Post } from '#/sdk/types.gen.ts'

/** Same default as playwright.config.ts. */
const appUrl = process.env.APP_URL ?? 'http://localhost:3000'

// verify:app trusts X-Forwarded-For from loopback, so every test signs in from its own client IP and never
// waits for another test's sign-in rate limit (3 per 10 s per IP). flows.spec.ts uses 198.18.x.x.
let clientCount = 0
const nextClientIp = (workerIndex: number) => `198.19.${workerIndex % 256}.${++clientCount % 256}`

export const test = base.extend({
  context: async ({ context }, provide, testInfo) => {
    await context.setExtraHTTPHeaders({ 'x-forwarded-for': nextClientIp(testInfo.workerIndex) })
    await provide(context)
  },
  request: async ({ playwright }, provide, testInfo) => {
    const request = await playwright.request.newContext({
      baseURL: appUrl,
      extraHTTPHeaders: { 'x-forwarded-for': nextClientIp(testInfo.workerIndex), origin: appUrl },
    })
    await provide(request)
    await request.dispose()
  },
})
export { expect }

const author = { email: process.env.TEST_USER_EMAIL!, password: process.env.TEST_USER_PASSWORD! }

/** Loads a page and waits for hydration (input before it is lost). */
export const visit = async (page: Page, path: string) => {
  await page.goto(path)
  await expect(page.locator('body[data-hydrated="true"]')).toBeAttached()
}

/** Signs the browser context in through the API, without touching the UI. */
export const signIn = async (page: Page) => {
  const res = await page.request.post('/api/auth/sign-in/email', { data: author, headers: { origin: appUrl } })
  expect(res.status()).toBe(200)
}

/** Publishes a post as the test author through the API (its own session, apart from the browser's). */
export const seedPost = async (request: APIRequestContext, body = `a11y seed ${crypto.randomUUID()}`) => {
  expect((await request.post('/api/auth/sign-in/email', { data: author })).status()).toBe(200)
  const res = await request.post('/api/me/posts', { data: { body } })
  expect(res.status()).toBe(201)
  return (await res.json()) as Post
}

export const fakePost = (body: string): Post => ({
  id: crypto.randomUUID(),
  body,
  authorName: 'Test Author',
  createdAt: '2026-01-02T03:04:05.000Z',
  updatedAt: '2026-01-02T03:04:05.000Z',
})

/**
 * Reaches `path` by client-side navigation (from /about, through the main navigation) while `api` answers
 * with `response`. SSR data comes from the in-process API and cannot be intercepted; a client navigation
 * fetches it from the browser, so empty lists and failures can be shown without touching the database.
 */
export const navigateWithApiResponse = async (
  page: Page,
  link: 'ProofStack' | 'Dashboard',
  api: string,
  response: { json: unknown; status?: number },
) => {
  await visit(page, '/about')
  await page.route(`**${api}`, (route) =>
    route.request().method() === 'GET' ? route.fulfill(response) : route.fallback(),
  )
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: link, exact: true }).click()
}

/** The dashboard with one post of the author's own, published through the UI. */
export const dashboardWithMyPost = async (page: Page) => {
  await signIn(page)
  await visit(page, '/dashboard')
  const body = `a11y post ${crypto.randomUUID()}`
  await page.getByLabel('New post').fill(body)
  await page.getByRole('button', { name: 'Publish' }).click()
  const post = page.getByTestId('my-posts').locator('li').filter({ hasText: body })
  await expect(post).toBeVisible()
  return { body, post, edit: post.getByRole('button', { name: /^Edit/ }) }
}

export const overTheLimit = 'x'.repeat(POST_MAX_LENGTH + 1)
