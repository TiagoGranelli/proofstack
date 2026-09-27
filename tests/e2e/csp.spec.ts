// Content-Security-Policy in the browser. Every E2E test fails on a violation (./fixtures.ts); these tests
// prove that the collector works and walk every page and navigation kind under both policies: the SSR
// nonce policy with 'strict-dynamic' and the hash policy of the prerendered /about.
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures.ts'

let clientCount = 0
test.beforeEach(async ({ context }, testInfo) => {
  await context.setExtraHTTPHeaders({ 'x-forwarded-for': `198.19.${testInfo.workerIndex % 256}.${++clientCount}` })
})

const author = { email: process.env.TEST_USER_EMAIL!, password: process.env.TEST_USER_PASSWORD! }

const hydrated = (page: Page) => expect(page.locator('body[data-hydrated="true"]')).toBeAttached()

const navLink = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name, exact: true })

test('blocks and reports markup injected into a page', async ({ page, cspViolations }) => {
  // Simulates stored XSS: the server's response, with its real policy, plus inline code without the nonce.
  await page.route('/', async (route) => {
    const response = await route.fetch()
    const injected = '<script>window.injected = true</script><style>body { color: red }</style>'
    await route.fulfill({ response, body: (await response.text()).replace('</main>', `${injected}</main>`) })
  })
  await page.goto('/')
  await hydrated(page)
  await expect
    .poll(() => cspViolations.map((v) => v.directive).toSorted())
    .toEqual(['script-src-elem', 'style-src-elem'])
  expect(await page.evaluate(() => 'injected' in window)).toBe(false)
  cspViolations.length = 0
})

test('SSR pages load every module and route chunk under the nonce policy', async ({ page, baseURL }) => {
  const response = await page.goto('/')
  expect(response?.headers()['content-security-policy']).toContain("'strict-dynamic'")
  await hydrated(page)
  // Client-side navigation loads each route's chunks through dynamic import and Vite's preload helper.
  await navLink(page, 'About').click()
  await expect(page.getByRole('heading', { name: 'About' })).toBeVisible()
  await navLink(page, 'Dashboard').click()
  await expect(page).toHaveURL(/\/login\?redirect=/)
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeEnabled()

  const signIn = await page.request.post('/api/auth/sign-in/email', { data: author, headers: { origin: baseURL! } })
  expect(signIn.status()).toBe(200)
  await page.goto('/dashboard')
  await hydrated(page)
  await expect(page.getByLabel('New post')).toBeVisible()
  await navLink(page, 'ProofStack').click()
  await expect(page.getByRole('heading', { name: 'Latest posts' })).toBeVisible()

  const missing = await page.goto('/no-such-page')
  expect(missing?.status()).toBe(404)
  await hydrated(page)
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
})

test('the prerendered page runs under its hash policy and navigates on', async ({ page }) => {
  const response = await page.goto('/about')
  const csp = response?.headers()['content-security-policy'] ?? ''
  expect(csp).toContain("'sha256-")
  expect(csp).not.toContain("'nonce-")
  await hydrated(page)
  await navLink(page, 'ProofStack').click()
  await expect(page.getByRole('heading', { name: 'Latest posts' })).toBeVisible()
  await navLink(page, 'About').click()
  await expect(page.getByRole('heading', { name: 'About' })).toBeVisible()
})
