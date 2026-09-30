// What a visitor does, in the production build: count words, and move between pages without a reload.
import { expect, test } from '@playwright/test'
import { visit } from './support/app.ts'

test('counts the words typed on the home page', async ({ page }) => {
  await visit(page, '/')
  await expect(page).toHaveTitle('Word counter')
  await page.getByRole('textbox', { name: 'Your text' }).fill('The quick brown fox')
  await expect(page.getByRole('status')).toHaveText('4 words')
})

test('the navigation moves to About and back in the browser, and names each page', async ({ page }) => {
  await visit(page, '/')
  const nav = page.getByRole('navigation', { name: 'Main' })
  await nav.getByRole('link', { name: 'About' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'About' })).toBeVisible()
  await expect(page).toHaveTitle('About · Word counter')
  await expect(nav.getByRole('link', { name: 'About' })).toHaveAttribute('aria-current', 'page')
  await nav.getByRole('link', { name: 'Word counter' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Word counter' })).toBeVisible()
  await expect(page).toHaveTitle('Word counter')
})

test('an unknown address shows the not-found page with a way back', async ({ page }) => {
  await visit(page, '/no-such-page')
  await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible()
  await page.getByRole('link', { name: 'Go to the word counter' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Word counter' })).toBeVisible()
})
