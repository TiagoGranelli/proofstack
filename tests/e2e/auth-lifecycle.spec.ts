// The account lifecycle on the open server (AUTH_SIGN_UP=open, mail to Mailpit). Every test works on
// a throwaway account (./support/accounts.ts), never the worker's `author`, and every browser context has its
// own client IP.
import type { APIRequestContext, Locator } from '@playwright/test'
import {
  createAccount,
  expectFormSignInRefused,
  expectSignedOut,
  mailLink,
  newAccount,
  requestPasswordReset,
  setPasswordWithLink,
  signedInElsewhere,
  signedInHereAndElsewhere,
  signInWithForm,
  signUpWithForm,
} from './support/accounts.ts'
import { type Author, expect, followLink, signIn, test, visit } from './support/app.ts'

/** Better Auth's own sign-in endpoint refuses `account` until its address is confirmed. */
const expectApiSignInUnverified = async (request: APIRequestContext, account: Author) => {
  const early = await request.post('/api/auth/sign-in/email', {
    data: { email: account.email, password: account.password },
  })
  expect(early.status()).toBe(403)
  expect(await early.json()).toMatchObject({ code: 'EMAIL_NOT_VERIFIED' })
}

/** Types `password` into the delete-account form (`deletion`) and presses Delete account. */
const submitDeletion = async (deletion: Locator, password: string) => {
  await deletion.getByLabel('Password', { exact: true }).fill(password)
  await deletion.getByRole('button', { name: 'Delete account' }).click()
}

test('signs up, confirms the address from the mail, then signs in', async ({ page, request }) => {
  const account = newAccount()

  await visit(page, '/login')
  await followLink(page, 'Create one', /\/sign-up$/)
  await signUpWithForm(page, account)
  await expect(page.getByRole('status')).toContainText(`Check your inbox at ${account.email}`)

  // Not before the address is confirmed.
  await expectFormSignInRefused(page, account, 'Confirm your email address first')

  const link = await mailLink(account.email, 'Confirm your email address', '/verify-email')
  // Following the link, as a mail scanner or a link preview does, confirms nothing.
  expect((await request.get(link)).status()).toBe(200)
  await expectApiSignInUnverified(request, account)

  // Its owner confirms with the button (a POST).
  await visit(page, link)
  await page.getByRole('button', { name: 'Confirm email' }).click()
  await expect(page.getByRole('status')).toContainText('Your email address is confirmed')
  await followLink(page, 'Sign in', /\/login$/)
  await signInWithForm(page, account)
  await expect(page).toHaveURL(/\/dashboard$/)
})

test('resets a forgotten password from the mailed link, which ends every session', async ({
  browser,
  page,
}, testInfo) => {
  const account = await createAccount()
  // Signed in elsewhere before the reset.
  const elsewhere = await signedInElsewhere(browser, testInfo, account)

  await requestPasswordReset(page, account.email)
  await expect(page.getByRole('status')).toContainText(account.email)

  const newPassword = `pw-${crypto.randomUUID()}`
  const link = await mailLink(account.email, 'Reset your password', '/reset-password')
  await setPasswordWithLink(page, link, newPassword)
  await expect(page.getByRole('status')).toContainText('Your password is changed')

  // The link works once.
  await setPasswordWithLink(page, link, `pw-${crypto.randomUUID()}`)
  await expect(page.getByRole('alert')).toContainText('This link is invalid or has expired')

  await expectSignedOut(await elsewhere.newPage())

  await expectFormSignInRefused(page, account, 'Wrong email or password')
  await signInWithForm(page, { email: account.email, password: newPassword })
  await expect(page).toHaveURL(/\/dashboard$/)
  await elsewhere.close()
})

test('changing the password signs out the other sessions and keeps this one', async ({ browser, page }, testInfo) => {
  const { account, elsewhere } = await signedInHereAndElsewhere(page, browser, testInfo)

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
  await elsewhere.close()
})

test('lists the sessions and signs out another one', async ({ browser, page }, testInfo) => {
  const { elsewhere } = await signedInHereAndElsewhere(page, browser, testInfo)

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
  await elsewhere.close()
})

test('deletes the account after the password and an explicit confirmation', async ({ page }) => {
  const account = await createAccount()
  await signIn(page, account)
  await visit(page, '/account')

  const deletion = page.getByRole('region', { name: 'Delete account' })
  // The confirmation checkbox is required: nothing is sent without it, and focus goes to it.
  await submitDeletion(deletion, 'not-the-password-123')
  await expect(deletion.getByRole('alert')).toHaveText('Confirm that you want to delete the account.')
  await expect(deletion.getByRole('checkbox')).toBeFocused()
  await deletion.getByRole('checkbox').check()
  await deletion.getByRole('button', { name: 'Delete account' }).click()
  await expect(deletion.getByRole('alert')).toContainText('That password is not correct')

  await submitDeletion(deletion, account.password)
  await expect(page).toHaveURL(/\/$/)
  await expectSignedOut(page)
  await expectFormSignInRefused(page, account, 'Wrong email or password')
})
