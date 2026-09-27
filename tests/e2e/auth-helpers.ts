// Shared by the account E2E specs: throwaway accounts, per-context client IPs, and links read from Mailpit.
import { type APIRequestContext, type Browser, type BrowserContext, expect, type Page } from '@playwright/test'

const mailpitUrl = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54380'

export type Account = { name: string; email: string; password: string }

export const newAccount = (): Account => ({
  name: 'E2E Account',
  email: `e2e-${crypto.randomUUID()}@example.test`,
  password: `pw-${crypto.randomUUID()}`,
})

let clients = 0
/**
 * A browser context with its own client IP. verify:app trusts X-Forwarded-For from the test process, so every
 * context gets its own sign-in rate-limit bucket (3 per 10 s) and no test waits for another's.
 */
export const newClient = (browser: Browser, baseURL: string, workerIndex: number): Promise<BrowserContext> =>
  browser.newContext({
    baseURL,
    extraHTTPHeaders: { 'x-forwarded-for': `198.19.${workerIndex % 256}.${(++clients % 250) + 1}` },
  })

export const visit = async (page: Page, path: string) => {
  await page.goto(path)
  await expect(page.locator('body[data-hydrated="true"]')).toBeAttached()
}

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

/** Signs up through Better Auth's endpoint and confirms the address from the mail: ready to sign in. */
export const createAccount = async (request: APIRequestContext, baseURL: string): Promise<Account> => {
  const account = newAccount()
  const res = await request.post('/api/auth/sign-up/email', { data: account, headers: { origin: baseURL } })
  expect(res.status()).toBe(200)
  const link = await mailLink(account.email, 'Confirm your email address', '/verify-email')
  const token = new URL(link).searchParams.get('token')!
  expect((await request.get(`/api/auth/verify-email?token=${encodeURIComponent(token)}`)).status()).toBe(200)
  return account
}

/** Signs the context in through the API, without touching the UI. */
export const signInWithApi = async (context: BrowserContext, baseURL: string, account: Account) => {
  const res = await context.request.post('/api/auth/sign-in/email', {
    data: { email: account.email, password: account.password },
    headers: { origin: baseURL },
  })
  expect(res.status()).toBe(200)
}

export const signInWithForm = async (page: Page, account: Pick<Account, 'email' | 'password'>) => {
  await page.getByLabel('Email').fill(account.email)
  await page.getByLabel('Password', { exact: true }).fill(account.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

/** Whether the context's session still works: a private page either renders or redirects to sign-in. */
export const expectSignedOut = async (page: Page) => {
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/login\?redirect=%2Fdashboard$/)
}
