// What moving between pages does beyond rendering them: focus and the screen-reader announcement after a
// client-side navigation, the not-found page's title, and the header's session, which costs no request of its own.
import type { Page } from '@playwright/test'
import { APP_NAME, pageTitle } from '#/config/app.ts'
import { expect, signIn, test, visit } from './support/app.ts'

const navLink = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name, exact: true })

/** The route announcer: a polite live region inside `main` (RouteAnnouncer). */
const announcer = (page: Page) => page.getByRole('main').locator('[aria-live="polite"]')

test('a client-side navigation moves focus to the new page heading and announces its title', async ({ page }) => {
  await visit(page, '/')
  await navLink(page, 'About').click()
  await expect(page).toHaveTitle(pageTitle('About'))
  await expect(page.getByRole('heading', { level: 1, name: 'About' })).toBeFocused()
  await expect(announcer(page)).toHaveText(pageTitle('About'))

  await navLink(page, APP_NAME).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Latest posts' })).toBeFocused()
  await expect(announcer(page)).toHaveText(pageTitle('Latest posts'))
})

test('the first page load announces nothing and leaves focus at the top of the document', async ({ page }) => {
  await visit(page, '/about')
  await expect(announcer(page)).toHaveText('')
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true)
})

test('an address no route matches is a 404 with its own title and heading', async ({ page }) => {
  const response = await visit(page, '/no-such-page')
  expect(response?.status()).toBe(404)
  await expect(page).toHaveTitle(pageTitle('Page not found'))
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Page not found')
})

test('the header shows who is signed in from the session SSR read, with no request of its own', async ({
  page,
  author,
}) => {
  await signIn(page, author)
  const serverFunctions: string[] = []
  page.on('request', (r) => r.url().includes('/_serverFn/') && serverFunctions.push(r.url()))
  await visit(page, '/')
  const nav = page.getByRole('navigation', { name: 'Main' })
  await expect(nav).toContainText(author.name)
  await expect(nav.getByRole('button', { name: 'Sign out' })).toBeVisible()
  // Between public pages the session comes from the cache that SSR filled.
  await navLink(page, 'About').click()
  await expect(page.getByRole('heading', { level: 1, name: 'About' })).toBeVisible()
  await navLink(page, APP_NAME).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Latest posts' })).toBeVisible()
  await expect(nav).toContainText(author.name)
  expect(serverFunctions).toEqual([])
})

test('a signed-out visitor is offered Sign in', async ({ page }) => {
  await visit(page, '/')
  await navLink(page, 'Sign in').click()
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeFocused()
})

test('the first Tab stop is a visible "Skip to content" that moves focus to the main region', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'keyboard navigation is a desktop concern')
  await visit(page, '/')
  await page.keyboard.press('Tab')
  const skip = page.getByRole('link', { name: 'Skip to content' })
  await expect(skip).toBeFocused()
  await expect(skip).toBeInViewport()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('main')).toBeFocused()
  // The next Tab continues inside the page, past the header.
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Load more posts' })).toBeFocused()
})
