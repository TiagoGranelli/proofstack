// axe (WCAG 2.2 AA + best practices) on every page and UI state the app has. To cover a new page or state, add
// one entry to STATES: a name and the steps that reach it; its landmark snapshot goes in ./landmarks.spec.ts.
import { expect, test, type Page } from '@playwright/test'
import { expectAccessible } from './support/a11y.ts'
import { visit } from './support/app.ts'

const STATES: Record<string, (page: Page) => Promise<unknown>> = {
  'home, empty': (page) => visit(page, '/'),
  'home, with text': async (page) => {
    await visit(page, '/')
    await page.getByRole('textbox', { name: 'Your text' }).fill('one two three')
    await expect(page.getByRole('status')).toHaveText('3 words')
  },
  'home, dark system theme': async (page) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await visit(page, '/')
  },
  about: (page) => visit(page, '/about'),
  'not found': (page) => visit(page, '/no-such-page'),
}

test.describe('axe', () => {
  for (const [state, reach] of Object.entries(STATES)) {
    test(state, async ({ page }) => {
      await reach(page)
      await expectAccessible(page, state)
    })
  }
})
