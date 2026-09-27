// Account lifecycle helpers for E2E specs: throwaway accounts, links read from the mail Mailpit caught, a second
// signed-in browser, and form sign-in. The verify:app server under test has AUTH_SIGN_UP=open and sends its mail
// to Mailpit (MAILPIT_URL).
import type { Browser, BrowserContext, Page, TestInfo } from '@playwright/test'
import { type Author, createAuthor, expect, nextClientIp } from './app.ts'

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

/** The page's context has no working session: a private page redirects to sign-in. */
export const expectSignedOut = async (page: Page) => {
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/login\?redirect=%2Fdashboard$/)
}
