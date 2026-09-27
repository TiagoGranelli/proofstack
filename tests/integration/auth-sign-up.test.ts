// The sign-up policy (AUTH_SIGN_UP). The main server runs `open`, the second one the default `closed`.
import { describe, expect, it } from 'vitest'
import { appUrl, clientIps, closedAppUrl, postSignIn, users } from './helpers.ts'

const nextIp = clientIps('100.64.3')

const signUp = (base: string, account: { name: string; email: string; password: string }, ip: string) =>
  fetch(`${base}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base, 'x-forwarded-for': ip },
    body: JSON.stringify(account),
  })

const newAccount = () => ({
  name: 'Sign-up Test',
  email: `sign-up-${crypto.randomUUID()}@example.test`,
  password: `pw-${crypto.randomUUID()}`,
})

/** What a sign-up answer reveals: whether it signed in, which user fields, and the verification state. */
const shape = (body: { token: unknown; user: Record<string, unknown> }) => ({
  token: body.token,
  user: Object.keys(body.user).toSorted(),
  emailVerified: body.user.emailVerified,
})

describe('closed sign-up', () => {
  it('has no sign-up endpoint', async () => {
    const res = await signUp(closedAppUrl, newAccount(), nextIp())
    expect(res.status).toBe(404)
  })

  it('has no sign-up page, and the sign-in page does not offer one', async () => {
    expect((await fetch(`${closedAppUrl}/sign-up`)).status).toBe(404)
    const login = await (await fetch(`${closedAppUrl}/login`)).text()
    expect(login).not.toContain('href="/sign-up"')
    expect(login).toContain('href="/forgot-password"')
  })
})

describe('open sign-up', () => {
  it('offers the sign-up page from the sign-in page', async () => {
    expect((await fetch(`${appUrl}/sign-up`)).status).toBe(200)
    expect(await (await fetch(`${appUrl}/login`)).text()).toContain('href="/sign-up"')
  })

  it('creates an account that cannot sign in before its address is verified', async () => {
    const account = newAccount()
    const res = await signUp(appUrl, account, nextIp())
    expect(res.status).toBe(200)
    // No session before verification (requireEmailVerification, autoSignIn off).
    expect(
      res.headers.getSetCookie().filter((cookie) => cookie.includes('session_token=') && !/=;/.test(cookie)),
    ).toEqual([])
    const signIn = await postSignIn(account, { 'x-forwarded-for': nextIp() })
    expect(signIn.status).toBe(403)
    expect(await signIn.json()).toMatchObject({ code: 'EMAIL_NOT_VERIFIED' })
  })

  it('answers a sign-up for an existing address like any other (no account enumeration)', async () => {
    const fresh = await signUp(appUrl, newAccount(), nextIp())
    const taken = await signUp(appUrl, { ...newAccount(), email: users.other.email }, nextIp())
    expect([fresh.status, taken.status]).toEqual([200, 200])
    expect(shape(await taken.json())).toEqual(shape(await fresh.json()))
  })
})
