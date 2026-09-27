// Signing in with JavaScript off: the login form posts itself to signInFromForm, which answers with a redirect
// (docs/decisions/0014-login-without-javascript.md). The same holds for a visitor who submits before hydration.
import type { Page } from '@playwright/test'
import { expect, test } from './support/app.ts'

test.use({ javaScriptEnabled: false })

const email = (page: Page) => page.getByRole('textbox', { name: 'Email', exact: true })

test('signs in without JavaScript and lands where the guard sent the visitor', async ({ page, author }) => {
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/login\?redirect=%2Fdashboard$/)
  await email(page).fill(author.email)
  await page.getByLabel('Password').fill(author.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`${author.name}'s posts`)
})

test('without JavaScript, a wrong password comes back as the same alert on the form', async ({ page, author }) => {
  await page.goto('/login')
  await email(page).fill(author.email)
  await page.getByLabel('Password').fill('not the password at all')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/login\?error=INVALID_EMAIL_OR_PASSWORD$/)
  await expect(page.getByRole('alert')).toHaveText('Wrong email or password.')
  await expect(page.locator('form')).toHaveAccessibleDescription('Wrong email or password.')
})
