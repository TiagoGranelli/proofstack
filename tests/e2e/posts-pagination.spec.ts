import type { Page } from '@playwright/test'
import { POSTS_PAGE_DEFAULT as PAGE_SIZE } from '#/contract/limits.ts'
import { expect, PAGINATED_AUTHOR, test, visit } from './support/app.ts'

// The author whose posts are paginated here is the seed project's (seed.setup.ts): no spec writes to their
// dashboard, so its contents are exactly what the seed published. The same posts are why `/` always has
// more than a page, whatever the other specs publish or delete meanwhile.

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

test.describe('as the seeded author', () => {
  test.use({ storageState: PAGINATED_AUTHOR.storageState })

  test('the dashboard renders the first page on the server and loads the rest with Load more', async ({ page }) => {
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

    // Space works too. The seed published two pages and a bit: the button goes away once the last page
    // is in, and focus is not lost with it.
    await loadMoreWithKeyboard(page, 'my-posts', ' ')
    await expect(page.getByRole('button', { name: 'Load more posts' })).toHaveCount(0)
    await expect(page.locator(':focus')).toHaveCount(1)
    // Every post exactly once, newest first.
    const bodies = await page.getByTestId('my-posts').locator('p').allTextContents()
    expect(bodies).toEqual(PAGINATED_AUTHOR.bodies.toReversed())
  })
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
