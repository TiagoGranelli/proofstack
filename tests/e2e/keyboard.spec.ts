// Keyboard use: Tab reaches every control in reading order with a visible focus indicator and then goes past the
// page's last control (no trap, see `tabThrough` in ./support/a11y.ts). scripts/route-coverage.ts requires a row for
// every page route in the `tab order` block.
import { expect, test, type Page } from '@playwright/test'
import { tabOrder } from './support/a11y.ts'
import { visit } from './support/app.ts'

const NAV = ['link "Word counter"', 'link "About"']

test.describe('tab order', () => {
  const pages: Array<[string, (page: Page) => Promise<unknown>, string[]]> = [
    ['home', (page) => visit(page, '/'), [...NAV, 'textbox "Your text"', 'button "Clear"']],
    ['about', (page) => visit(page, '/about'), NAV],
  ]
  for (const [name, reach, stops] of pages) {
    test(name, async ({ page }) => {
      await reach(page)
      const order = await tabOrder(page)
      expect(order.map((stop) => stop.name)).toEqual(stops)
      expect(order.filter((stop) => !stop.visibleFocus).map((stop) => stop.name)).toEqual([])
    })
  }
})

test.describe('keyboard', () => {
  test('Clear empties the field from the keyboard', async ({ page }) => {
    await visit(page, '/')
    await page.getByRole('textbox', { name: 'Your text' }).fill('some words')
    await page.getByRole('button', { name: 'Clear' }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('textbox', { name: 'Your text' })).toHaveValue('')
    await expect(page.getByRole('status')).toHaveText('0 words')
  })
})
