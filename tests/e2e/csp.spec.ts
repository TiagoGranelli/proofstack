// Content-Security-Policy in the browser. Every E2E test fails on a violation (./fixtures.ts, through
// ./support/app.ts); these tests prove that the collector works and walk every page and navigation kind
// under both policies: the SSR nonce policy with 'strict-dynamic' and the hash policy of the prerendered
// /about.
import type { Page } from '@playwright/test'
import { APP_NAME } from '#/config/app.ts'
import { expect, signIn, test, visit } from './support/app.ts'

const navLink = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name, exact: true })

/** On the home page, rendered: its URL and its page heading. */
const expectHome = async (page: Page) => {
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
}

test('blocks and reports markup injected into a page', async ({ page, cspViolations }) => {
  // Simulates stored XSS: the server's response, with its real policy, plus inline code without the nonce.
  await page.route('/', async (route) => {
    // Playwright's fetch cannot decode zstd, which Firefox accepts and the edge then uses (`TEST_EDGE=1`).
    const response = await route.fetch({ headers: { ...route.request().headers(), 'accept-encoding': 'gzip' } })
    const injected = '<script>window.injected = true</script><style>body { color: red }</style>'
    // The body is passed decoded, so the edge's Content-Encoding must not describe it.
    const { 'content-encoding': _encoding, 'content-length': _length, ...headers } = response.headers()
    await route.fulfill({
      response,
      headers,
      body: (await response.text()).replace('</main>', `${injected}</main>`),
    })
  })
  await visit(page, '/')
  await expect
    .poll(() => cspViolations.map((v) => v.directive).toSorted())
    .toEqual(['script-src-elem', 'style-src-elem'])
  expect(await page.evaluate(() => 'injected' in window)).toBe(false)
  cspViolations.length = 0
})

test('SSR pages load every module and route chunk under the nonce policy', async ({ page, author }) => {
  const response = await visit(page, '/')
  expect(response?.headers()['content-security-policy']).toContain("'strict-dynamic'")
  // Client-side navigation loads each route's chunks through dynamic import and Vite's preload helper.
  await navLink(page, 'About').click()
  await expect(page.getByRole('heading', { name: 'About' })).toBeVisible()
  await navLink(page, 'Sign in').click()
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeEnabled()

  await signIn(page, author)
  await visit(page, '/dashboard')
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
  await navLink(page, APP_NAME).click()
  await expectHome(page)

  const missing = await visit(page, '/no-such-page')
  expect(missing?.status()).toBe(404)
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
})

test('the prerendered page runs under its hash policy and navigates on', async ({ page }) => {
  const response = await visit(page, '/about')
  const csp = response?.headers()['content-security-policy'] ?? ''
  expect(csp).toContain("'sha256-")
  expect(csp).not.toContain("'nonce-")
  await navLink(page, APP_NAME).click()
  await expectHome(page)
  await navLink(page, 'About').click()
  await expect(page.getByRole('heading', { name: 'About' })).toBeVisible()
})
