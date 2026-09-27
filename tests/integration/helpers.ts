// Shared by the integration tests. `pnpm verify:app` provides every variable read here (see global-setup.ts).
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { createClient } from '#/sdk/client/index.ts'

export const appUrl = process.env.APP_URL!
/** A second server on the same database: AUTH_SIGN_UP=closed, and TRUSTED_PROXIES excludes the test process. */
export const closedAppUrl = process.env.CLOSED_APP_URL!

export const users = {
  author: {
    email: process.env.TEST_USER_EMAIL!,
    password: process.env.TEST_USER_PASSWORD!,
    name: process.env.TEST_USER_NAME!,
  },
  other: {
    email: process.env.TEST_OTHER_USER_EMAIL!,
    password: process.env.TEST_OTHER_USER_PASSWORD!,
    name: process.env.TEST_OTHER_USER_NAME!,
  },
}

/**
 * Client IPs for one test file. verify:app starts the server with loopback in TRUSTED_PROXIES, so the
 * X-Forwarded-For value the tests send is the client IP, and each value is its own sign-in rate-limit bucket
 * (3 per 10 s): give every file its own prefix and every group of sign-ins its own address, and no test ever
 * waits for another's bucket to drain. Requests without X-Forwarded-For come from the trusted proxy itself and
 * share one bucket.
 */
export const clientIps = (prefix: string) => {
  let last = 0
  return () => `${prefix}.${++last}`
}

const SESSION_COOKIE = /^(__Secure-)?better-auth\.session_token=/

/** The session cookie a response set last (a response can clear a stale cookie before setting a new one). */
export const sessionCookie = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0]!)
    .findLast((c) => SESSION_COOKIE.test(c) && !c.endsWith('='))

export const postSignIn = (
  credentials: { email: string; password: string },
  headers: Record<string, string> & { 'x-forwarded-for': string },
) =>
  fetch(`${appUrl}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: appUrl, ...headers },
    body: JSON.stringify({ email: credentials.email, password: credentials.password }),
  })

/** Signs in and returns the session cookie; fails the test on anything but 200. */
export const signIn = async (credentials: { email: string; password: string }, ip: string) => {
  const res = await postSignIn(credentials, { 'x-forwarded-for': ip })
  if (res.status !== 200) throw new Error(`sign-in as ${credentials.email} failed: ${res.status} ${await res.text()}`)
  const cookie = sessionCookie(res)
  if (!cookie) throw new Error(`sign-in as ${credentials.email} set no session cookie`)
  return cookie
}

/** An SDK client that sends the session cookie and our Origin, like the browser app. */
export const sdkClient = (cookie?: string) =>
  createClient({ baseUrl: appUrl, headers: cookie ? { cookie, origin: appUrl } : {} })

const CREATE_USER = fileURLToPath(new URL('../../scripts/create-user.ts', import.meta.url))

/**
 * A throwaway verified account, created through scripts/create-user.ts (the operator path) with the app's
 * environment that verify:app passes to the tests, named after `label`. For tests that change or delete an
 * account, or write more than the shared `users` can absorb under the per-user write limit.
 */
export const createUser = async (label: string) => {
  const account = {
    email: `${label}-${crypto.randomUUID()}@example.test`,
    name: `Integration ${label}`,
    password: `pw-${crypto.randomUUID()}`,
  }
  await promisify(execFile)(process.execPath, [CREATE_USER, account.email, account.name], {
    env: { ...process.env, CREATE_USER_PASSWORD: account.password },
  })
  return account
}
