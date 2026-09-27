// The account lifecycle on the main verify:app server (AUTH_SIGN_UP=open, mail to Mailpit). Every test works on
// throwaway accounts, and every browser context has its own client IP (auth-helpers.ts).
import { expect, test } from '@playwright/test'
import {
  createAccount,
  expectSignedOut,
  mailLink,
  newAccount,
  newClient,
  signInWithApi,
  signInWithForm,
  visit,
} from './auth-helpers.ts'

test('signs up, confirms the address from the mail, then signs in', async ({ browser, baseURL }, testInfo) => {
  const context = await newClient(browser, baseURL!, testInfo.workerIndex)
  const page = await context.newPage()
  const account = newAccount()

  await visit(page, '/login')
  await page.getByRole('link', { name: 'Create one' }).click()
  await expect(page).toHaveURL(/\/sign-up$/)
  await expect(page.locator('body[data-hydrated="true"]')).toBeAttached()
  await page.getByLabel('Name').fill(account.name)
  await page.getByLabel('Email').fill(account.email)
  await page.getByLabel('Password').fill(account.password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('status')).toContainText(`Check your inbox at ${account.email}`)

  // Not before the address is confirmed.
  await visit(page, '/login')
  await signInWithForm(page, account)
  await expect(page.getByRole('alert')).toContainText('Confirm your email address first')

  await visit(page, await mailLink(account.email, 'Confirm your email address', '/verify-email'))
  await expect(page.getByRole('status')).toContainText('Your email address is confirmed')
  await page.getByRole('link', { name: 'Sign in' }).click()
  await expect(page.locator('body[data-hydrated="true"]')).toBeAttached()
  await signInWithForm(page, account)
  await expect(page).toHaveURL(/\/dashboard$/)
  await context.close()
})

test('resets a forgotten password from the mailed link, which ends every session', async ({
  browser,
  baseURL,
}, testInfo) => {
  const context = await newClient(browser, baseURL!, testInfo.workerIndex)
  const account = await createAccount(context.request, baseURL!)
  // Signed in elsewhere before the reset.
  const elsewhere = await newClient(browser, baseURL!, testInfo.workerIndex)
  await signInWithApi(elsewhere, baseURL!, account)

  const page = await context.newPage()
  await visit(page, '/login')
  await page.getByRole('link', { name: 'Forgot your password?' }).click()
  await expect(page.locator('body[data-hydrated="true"]')).toBeAttached()
  await page.getByLabel('Email').fill(account.email)
  await page.getByRole('button', { name: 'Send reset link' }).click()
  await expect(page.getByRole('status')).toContainText(account.email)

  const newPassword = `pw-${crypto.randomUUID()}`
  const link = await mailLink(account.email, 'Reset your password', '/reset-password')
  await visit(page, link)
  await page.getByLabel('New password').fill(newPassword)
  await page.getByRole('button', { name: 'Set new password' }).click()
  await expect(page.getByRole('status')).toContainText('Your password is changed')

  // The link works once.
  await visit(page, link)
  await page.getByLabel('New password').fill(`pw-${crypto.randomUUID()}`)
  await page.getByRole('button', { name: 'Set new password' }).click()
  await expect(page.getByRole('alert')).toContainText('This link is invalid or has expired')

  await expectSignedOut(await elsewhere.newPage())

  await visit(page, '/login')
  await signInWithForm(page, account)
  await expect(page.getByRole('alert')).toContainText('Wrong email or password')
  await signInWithForm(page, { email: account.email, password: newPassword })
  await expect(page).toHaveURL(/\/dashboard$/)
  await Promise.all([context.close(), elsewhere.close()])
})

test('changing the password signs out the other sessions and keeps this one', async ({
  browser,
  baseURL,
}, testInfo) => {
  const context = await newClient(browser, baseURL!, testInfo.workerIndex)
  const account = await createAccount(context.request, baseURL!)
  const elsewhere = await newClient(browser, baseURL!, testInfo.workerIndex)
  await Promise.all([signInWithApi(context, baseURL!, account), signInWithApi(elsewhere, baseURL!, account)])

  const page = await context.newPage()
  await visit(page, '/account')
  const newPassword = `pw-${crypto.randomUUID()}`
  await page.getByLabel('Current password').fill(account.password)
  await page.getByLabel('New password').fill(newPassword)
  await page.getByRole('button', { name: 'Change password' }).click()
  await expect(page.getByRole('status')).toContainText('Password changed')
  await expect(page.getByTestId('sessions').getByRole('listitem')).toHaveCount(1)

  await expectSignedOut(await elsewhere.newPage())
  await visit(page, '/account')
  await expect(page.getByRole('heading', { name: 'Account', exact: true })).toBeVisible()
  await Promise.all([context.close(), elsewhere.close()])
})

test('lists the sessions and signs out another one', async ({ browser, baseURL }, testInfo) => {
  const context = await newClient(browser, baseURL!, testInfo.workerIndex)
  const account = await createAccount(context.request, baseURL!)
  const elsewhere = await newClient(browser, baseURL!, testInfo.workerIndex)
  await Promise.all([signInWithApi(context, baseURL!, account), signInWithApi(elsewhere, baseURL!, account)])

  const page = await context.newPage()
  await visit(page, '/account')
  const sessions = page.getByTestId('sessions').getByRole('listitem')
  await expect(sessions).toHaveCount(2)
  await expect(sessions.filter({ hasText: '(this browser)' })).toHaveCount(1)
  await sessions
    .filter({ hasNotText: '(this browser)' })
    .getByRole('button', { name: /^Sign out / })
    .click()
  await expect(sessions).toHaveCount(1)

  await expectSignedOut(await elsewhere.newPage())
  await visit(page, '/account')
  await expect(sessions).toHaveCount(1)

  await page.getByRole('button', { name: 'Sign out everywhere' }).click()
  await expect(page).toHaveURL(/\/login$/)
  await expectSignedOut(page)
  await Promise.all([context.close(), elsewhere.close()])
})

test('deletes the account after the password and an explicit confirmation', async ({ browser, baseURL }, testInfo) => {
  const context = await newClient(browser, baseURL!, testInfo.workerIndex)
  const account = await createAccount(context.request, baseURL!)
  await signInWithApi(context, baseURL!, account)
  const page = await context.newPage()
  await visit(page, '/account')

  const deletion = page.getByRole('region', { name: 'Delete account' })
  await deletion.getByLabel('Password', { exact: true }).fill('not-the-password-123')
  // The confirmation checkbox is required: nothing is sent without it.
  await deletion.getByRole('button', { name: 'Delete account' }).click()
  await expect(deletion.getByRole('alert')).toHaveCount(0)
  await deletion.getByRole('checkbox').check()
  await deletion.getByRole('button', { name: 'Delete account' }).click()
  await expect(deletion.getByRole('alert')).toContainText('That password is not correct')

  await deletion.getByLabel('Password', { exact: true }).fill(account.password)
  await deletion.getByRole('button', { name: 'Delete account' }).click()
  await expect(page).toHaveURL(/\/$/)
  await expectSignedOut(page)
  await visit(page, '/login')
  await signInWithForm(page, account)
  await expect(page.getByRole('alert')).toContainText('Wrong email or password')
  await context.close()
})
