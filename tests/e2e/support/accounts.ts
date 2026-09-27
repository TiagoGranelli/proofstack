// Account lifecycle helpers for E2E specs: throwaway accounts, links read from the mail Mailpit caught, a second
// signed-in browser, and form sign-in. The open server under test has AUTH_SIGN_UP=open and sends its mail
// to Mailpit (MAILPIT_URL).
import type { Browser, BrowserContext, Page, TestInfo } from '@playwright/test'
import { type Author, createAuthor, expect, followLink, nextClientIp, signIn, visit } from './app.ts'

/** Same default as playwright.config.ts. */
const appUrl = process.env.APP_URL ?? 'http://localhost:3000'
const mailpitUrl = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54380'

export const newAccount = (): Author => ({
  name: 'E2E Account',
  email: `e2e-${crypto.randomUUID()}@example.test`,
  password: `pw-${crypto.randomUUID()}`,
})

/**
 * Another browser context with a client IP of its own, for "signed in elsewhere". It has no CSP violation
 * collector (the test's own `context` does); close it at the end of the test.
 */
export const newClient = (browser: Browser, testInfo: TestInfo): Promise<BrowserContext> =>
  browser.newContext({
    baseURL: appUrl,
    extraHTTPHeaders: { 'x-forwarded-for': nextClientIp(testInfo.workerIndex) },
  })

type MailSummary = { ID: string; Subject: string }

/** The first link to `path` in the newest mail to `to` whose subject is `subject`; waits for it to arrive. */
export const mailLink = async (to: string, subject: string, path: '/verify-email' | '/reset-password') => {
  let id: string | undefined
  await expect
    .poll(
      async () => {
        const query = encodeURIComponent(`to:"${to}" subject:"${subject}"`)
        const res = await fetch(`${mailpitUrl}/api/v1/search?query=${query}`)
        const { messages } = (await res.json()) as { messages: MailSummary[] }
        id = messages.find((message) => message.Subject === subject)?.ID
        return id
      },
      { message: `mail "${subject}" to ${to}`, timeout: 10_000 },
    )
    .toBeTruthy()
  const message = (await (await fetch(`${mailpitUrl}/api/v1/message/${id}`)).json()) as { Text: string }
  const link = message.Text.match(new RegExp(`https?://\\S+${path}\\?token=\\S+`))?.[0]
  expect(link, `link to ${path} in "${subject}"`).toBeTruthy()
  return link!
}

/**
 * A throwaway account, ready to sign in: created verified like the workers' authors (scripts/create-user.ts).
 * Sign-up and confirmation happen only in the browser, through the UI (auth-lifecycle.spec.ts): Better Auth's
 * own endpoints for them are not exposed over HTTP.
 */
export const createAccount = (): Promise<Author> => createAuthor('E2E Account')

export const signInWithForm = async (page: Page, account: Pick<Author, 'email' | 'password'>) => {
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(account.email)
  await page.getByLabel('Password', { exact: true }).fill(account.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

/** Signs in through the form on /login and expects the form to refuse, saying `message`. */
export const expectFormSignInRefused = async (
  page: Page,
  account: Pick<Author, 'email' | 'password'>,
  message: string,
) => {
  await visit(page, '/login')
  await signInWithForm(page, account)
  await expect(page.getByRole('alert')).toContainText(message)
}

/** Fills the sign-up form (on /sign-up) with `account` and submits it. */
export const signUpWithForm = async (page: Page, account: Author) => {
  await page.getByLabel('Name').fill(account.name)
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(account.email)
  await page.getByLabel('Password').fill(account.password)
  await page.getByRole('button', { name: 'Create account' }).click()
}

/** From /login, follows "Forgot your password?" and asks for a reset link for `email`. */
export const requestPasswordReset = async (page: Page, email: string) => {
  await visit(page, '/login')
  await followLink(page, 'Forgot your password?', /\/forgot-password$/)
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(email)
  await page.getByRole('button', { name: 'Send reset link' }).click()
}

/** Opens a mailed reset `link` and sets `password` with it. */
export const setPasswordWithLink = async (page: Page, link: string, password: string) => {
  await visit(page, link)
  await page.getByLabel('New password').fill(password)
  await page.getByRole('button', { name: 'Set new password' }).click()
}

/** `account` signed in on a second browser context (see `newClient`); close it at the end of the test. */
export const signedInElsewhere = async (browser: Browser, testInfo: TestInfo, account: Author) => {
  const elsewhere = await newClient(browser, testInfo)
  await signIn(elsewhere.request, account)
  return elsewhere
}

/** A throwaway account signed in on `page` and on a second browser context, `elsewhere` (close it at the end). */
export const signedInHereAndElsewhere = async (page: Page, browser: Browser, testInfo: TestInfo) => {
  const account = await createAccount()
  const [elsewhere] = await Promise.all([signedInElsewhere(browser, testInfo, account), signIn(page, account)])
  return { account, elsewhere }
}

/** The page's context has no working session: a private page redirects to sign-in. */
export const expectSignedOut = async (page: Page) => {
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/login\?redirect=%2Fdashboard$/)
}
