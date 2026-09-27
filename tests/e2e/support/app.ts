// Shared by every E2E spec: a `test` whose browser and API contexts each come from their own client IP and
// whose worker has an author of its own, and the steps that bring the app into a given state.
//
// Isolation. The specs run in parallel against one server and one database, so no spec may depend on data
// another spec writes:
// - Every worker signs in as its own `author`, created for it (verified) through scripts/create-user.ts, the
//   same path an operator uses. A worker runs one test at a time, so a dashboard only ever shows the posts
//   of tests in that worker, and each test finds its own by a unique body. Tests that change or delete an
//   account use a throwaway one from ./accounts.ts instead.
// - States that need the whole app to look a certain way (no posts at all, an API failure) are reached with
//   `navigateWithApiResponse`, which answers the browser's own API call instead of changing the database.
// - The public list is shared by definition. The one bulk write, more posts than fit on a page, happens in
//   the `seed` project (seed.setup.ts) before any spec starts; after that a test publishes at most a post or
//   two, so a post published moments ago is on the first page of `/`.
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import type { APIRequestContext, Page, Route, TestInfo } from '@playwright/test'
import { POST_MAX_LENGTH, POSTS_PAGE_DEFAULT } from '#/contract/limits.ts'
import type { Post, PostPage } from '#/sdk/types.gen.ts'
// Every spec gets the Content-Security-Policy violation collector from ../fixtures.ts.
import { test as base, expect } from '../fixtures.ts'

/** Same default as playwright.config.ts. */
const appUrl = process.env.APP_URL ?? 'http://localhost:3000'

export type Author = { email: string; name: string; password: string }

const CREATE_USER = fileURLToPath(new URL('../../../scripts/create-user.ts', import.meta.url))

/**
 * A new account, created through scripts/create-user.ts. The script writes to the app's database, so it
 * needs the environment the app runs with (DATABASE_URL and the rest); verify:app passes it to Playwright.
 */
export const createAuthor = async (name: string): Promise<Author> => {
  if (!process.env.DATABASE_URL)
    throw new Error(
      'E2E tests create their authors with scripts/create-user.ts, which needs the DATABASE_URL of the app under ' +
        'test. Run them through `pnpm verify:app`, or set the app environment yourself.',
    )
  const author = { email: `e2e-${crypto.randomUUID()}@example.test`, name, password: `pw-${crypto.randomUUID()}` }
  try {
    await promisify(execFile)(process.execPath, [CREATE_USER, author.email, author.name], {
      env: { ...process.env, PROOFSTACK_USER_PASSWORD: author.password },
    })
  } catch (error) {
    const { stderr } = error as { stderr?: string }
    throw new Error(`could not create the E2E author ${author.email}: ${stderr?.trim() || String(error)}`, {
      cause: error,
    })
  }
  return author
}

// verify:app trusts X-Forwarded-For from loopback, so every browser and API context signs in from its own
// client IP and never waits for another's sign-in rate limit (3 per 10 s per IP). The integration tests use
// other ranges (tests/integration).
let clientCount = 0
export const nextClientIp = (workerIndex: number) => `198.19.${workerIndex % 256}.${++clientCount % 256}`

export const test = base.extend<object, { author: Author }>({
  author: [
    // Playwright reads the fixtures a fixture uses from its first parameter, which must be a destructuring.
    // oxlint-disable-next-line no-empty-pattern
    async ({}, provide, workerInfo) => provide(await createAuthor(`E2E Author ${workerInfo.workerIndex}`)),
    { scope: 'worker' },
  ],
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

/** Loads a page and waits for hydration (input before it is lost). */
export const visit = async (page: Page, path: string) => {
  await page.goto(path)
  await expect(page.locator('body[data-hydrated="true"]')).toBeAttached()
}

/** Signs a browser context (through its page) or an API context in, without touching the UI. */
export const signIn = async (client: Page | APIRequestContext, author: Author) => {
  const request = 'request' in client ? client.request : client
  const res = await request.post('/api/auth/sign-in/email', {
    data: { email: author.email, password: author.password },
    headers: { origin: appUrl },
  })
  expect(res.status()).toBe(200)
}

const abortPost = (route: Route) => (route.request().method() === 'POST' ? route.abort() : route.fallback())

/**
 * Makes the page's server function POSTs fail like a lost connection: sign-out and every other account action
 * (src/lib/auth.functions.ts). The GET server functions (the route guards' session check) still pass. Returns
 * the undo.
 */
export const failServerFunctionPosts = async (page: Page) => {
  await page.route('**/_serverFn/**', abortPost)
  return () => page.unroute('**/_serverFn/**', abortPost)
}

/** Publishes a post as `author` through the API (its own session, apart from the browser's). */
export const seedPost = async (request: APIRequestContext, author: Author, body = `seed ${crypto.randomUUID()}`) => {
  await signIn(request, author)
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

/** A last page (no Load more) holding exactly `posts`, as GET /api/posts and GET /api/me/posts answer. */
export const lastPage = (...posts: Post[]): PostPage => ({ items: posts, nextCursor: null })

/** The main-navigation link whose client-side navigation fetches each list. */
const LIST_LINK = { '/api/posts': 'ProofStack', '/api/me/posts': 'Dashboard' } as const

/**
 * Reaches the page that shows `api` by client-side navigation (from /about, through the main navigation)
 * while the browser's request for its first page is answered with `response`: a `PostPage`, or an error
 * status with any body. SSR data comes from the in-process API and cannot be intercepted; a client navigation
 * fetches it from the browser, so empty lists and failures can be shown without touching the database.
 */
export const navigateWithApiResponse = async (
  page: Page,
  api: keyof typeof LIST_LINK,
  response: { json: PostPage } | { status: number; json: unknown },
) => {
  await visit(page, '/about')
  await page.route(`**${api}`, (route) =>
    route.request().method() === 'GET' ? route.fulfill(response) : route.fallback(),
  )
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: LIST_LINK[api], exact: true }).click()
}

/** The dashboard with one new post of the author's own, published through the UI. */
export const dashboardWithMyPost = async (page: Page, author: Author) => {
  await signIn(page, author)
  await visit(page, '/dashboard')
  const body = `a11y post ${crypto.randomUUID()}`
  await page.getByLabel('New post').fill(body)
  await page.getByRole('button', { name: 'Publish' }).click()
  const post = page.getByTestId('my-posts').locator('li').filter({ hasText: body })
  await expect(post).toBeVisible()
  return { body, post, edit: post.getByRole('button', { name: /^Edit/ }) }
}

export const overTheLimit = 'x'.repeat(POST_MAX_LENGTH + 1)

/**
 * The author the `seed` project (seed.setup.ts) creates with more posts than fit on one page, and that no
 * spec writes to: posts-pagination.spec.ts browses its dashboard, signed in through `storageState`.
 */
export const PAGINATED_AUTHOR = {
  // Two full pages and part of a third, so Load more is used twice and then goes away.
  bodies: Array.from({ length: 2 * POSTS_PAGE_DEFAULT + 5 }, (_, i) => `paginated post ${i + 1}`),
  // Inside Playwright's output directory (`outputDir` in playwright.config.ts, shared by every project), which it
  // empties at the start of every run. Derived from the running test, not written as a path: the file exists only
  // during an E2E run.
  storageState: (testInfo: TestInfo) => join(testInfo.project.outputDir, '.seed', 'paginated-author.json'),
}
