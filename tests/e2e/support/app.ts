// Shared by every E2E spec: the step that opens a page and waits for the app to render it.
import { expect, type Page } from '@playwright/test'

/**
 * Opens `path` and waits until the router has rendered its page. The app renders in the browser, so the HTML the
 * server sends is an empty shell until the script runs; a page's `h1` is the sign that it is there.
 * scripts/route-coverage.ts reads `visit(page, '/path')` to know which pages a spec reaches.
 */
export async function visit(page: Page, path: string): Promise<void> {
  await page.goto(path)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
}
