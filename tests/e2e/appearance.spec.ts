// Themes and forced colors in the browser: the system theme without JavaScript, a chosen theme applied before the
// app's scripts run (no flash of the other one) under both CSP policies, and focus and selection that stay visible
// in forced colors (Windows High Contrast), which drops backgrounds and box shadows.
import type { Page } from '@playwright/test'
import { expect, test, visit } from './support/app.ts'

/** The page background as the browser paints it, as `rgb(r, g, b)` (a canvas pixel, whatever the color syntax). */
const background = (page: Page) =>
  page.evaluate(() => {
    const context = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d')!
    context.fillStyle = getComputedStyle(document.body).backgroundColor
    context.fillRect(0, 0, 1, 1)
    const [red, green, blue] = context.getImageData(0, 0, 1, 1).data
    return `rgb(${red}, ${green}, ${blue})`
  })

const WHITE = 'rgb(255, 255, 255)'
/** --background in the dark theme, oklch(0.145 0 0). */
const NEAR_BLACK = 'rgb(10, 10, 10)'

test('follows the system theme with CSS alone, JavaScript off', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, colorScheme: 'dark' })
  const page = await context.newPage()
  await page.goto('/login')
  expect(await background(page)).toBe(NEAR_BLACK)
  await context.close()
})

for (const path of ['/', '/about']) {
  test(`a chosen theme is on ${path} from the first paint, before the app's scripts run`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await page.addInitScript(() => localStorage.setItem('theme', 'dark'))
    // Without the app's modules only the inline head script can apply it (nonce on `/`, hash on the prerendered
    // /about); a CSP violation would fail the test (fixtures.ts).
    await page.route('**/assets/*.js', (route) => route.abort())
    await page.goto(path)
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    expect(await background(page)).toBe(NEAR_BLACK)
  })
}

test('the theme choice applies at once, survives a reload, and System hands back to the system', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await visit(page, '/')
  expect(await background(page)).toBe(NEAR_BLACK)
  await page.getByRole('radio', { name: 'Light' }).check()
  expect(await background(page)).toBe(WHITE)
  await visit(page, '/')
  await expect(page.getByRole('radio', { name: 'Light' })).toBeChecked()
  expect(await background(page)).toBe(WHITE)
  await page.getByRole('radio', { name: 'System' }).check()
  expect(await background(page)).toBe(NEAR_BLACK)
})

/** The focused element's tag and outline: forced colors keep outlines, but drop the box shadows of rings. */
const focusOutline = (page: Page) =>
  page.locator(':focus').evaluate((element) => {
    const style = getComputedStyle(element)
    // Buttons transition into their outline; read it where it ends.
    return Promise.all(element.getAnimations().map((animation) => animation.finished)).then(
      () => `${element.tagName.toLowerCase()} ${style.outlineStyle} ${style.outlineWidth}`,
    )
  })

/** The background of a theme choice's segment, and the system's selection color to compare it with. */
const segmentColors = (page: Page, name: string) =>
  page
    .getByRole('radio', { name })
    .locator('..')
    .evaluate((label) => {
      const probe = document.createElement('span')
      document.body.append(probe)
      probe.style.backgroundColor = 'Highlight'
      const highlight = getComputedStyle(probe).backgroundColor
      probe.remove()
      return { background: getComputedStyle(label).backgroundColor, highlight }
    })

test.describe('forced colors', () => {
  test.skip(({ isMobile }) => isMobile, 'Windows High Contrast is a desktop setting')
  test.use({ forcedColors: 'active' })

  test('keeps keyboard focus visible as an outline on links, fields and buttons', async ({ page }) => {
    await visit(page, '/login')
    const outlines: string[] = []
    // Skip link, the header's three links, then the form's two fields and its button.
    for (let press = 0; press < 7; press++) {
      await page.keyboard.press('Tab')
      outlines.push(await focusOutline(page))
    }
    expect(outlines).toEqual([
      ...Array.from({ length: 4 }, () => 'a solid 2px'),
      'input solid 2px',
      'input solid 2px',
      'button solid 2px',
    ])
  })

  test('shows the chosen theme and the current page without relying on color', async ({ page }) => {
    await visit(page, '/about')
    // The checked segment takes the system's selection color; the others do not.
    const checked = await segmentColors(page, 'System')
    expect(checked.background).toBe(checked.highlight)
    expect((await segmentColors(page, 'Dark')).background).not.toBe(checked.highlight)
    const about = page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'About' })
    await expect(about).toHaveAttribute('aria-current', 'page')
    await expect(about).toHaveCSS('text-decoration-line', 'underline')
  })
})
