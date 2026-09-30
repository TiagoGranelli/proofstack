// The landmark structure and headings of every page, as ARIA snapshots. Partial snapshots: only what is listed is
// checked, in order. scripts/route-coverage.ts requires one for every page route in the `landmarks` block.
import { expect, test } from '@playwright/test'
import { SITE_HEADER } from './support/a11y.ts'
import { visit } from './support/app.ts'

test.describe('landmarks', () => {
  test('home', async ({ page }) => {
    await visit(page, '/')
    await expect(page.locator('body')).toMatchAriaSnapshot(`${SITE_HEADER}
- main:
  - heading "Word counter" [level=1]
  - paragraph
  - text: Your text
  - textbox "Your text"
  - status: 0 words
  - button "Clear"`)
  })

  test('about', async ({ page }) => {
    await visit(page, '/about')
    await expect(page.locator('body')).toMatchAriaSnapshot(`${SITE_HEADER}
- main:
  - heading "About" [level=1]
  - paragraph`)
  })
})
