// The closed server (CLOSED_APP_URL) runs the default AUTH_SIGN_UP=closed: no way to create an account over HTTP.
import { expect, test } from './support/app.ts'

const closedAppUrl = process.env.CLOSED_APP_URL!

test('closed sign-up has no sign-up page and no link to one', async ({ page }) => {
  const res = await page.goto(`${closedAppUrl}/sign-up`)
  expect(res?.status()).toBe(404)
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()

  await page.goto(`${closedAppUrl}/login`)
  await expect(page.locator('body[data-hydrated="true"]')).toBeAttached()
  await expect(page.getByRole('link', { name: 'Forgot your password?' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Create one' })).toHaveCount(0)
})
