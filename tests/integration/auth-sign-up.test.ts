// The sign-up policy (AUTH_SIGN_UP). The main server runs `open`, the second one the default `closed`. The UI
// signs up through the signUp server function; /api/auth/sign-up/email is not exposed in either mode.
import { describe, expect, it } from 'vitest'
import { appUrl, clientIps, closedAppUrl, postSignIn, users } from './helpers.ts'
import { callAuthFunction } from './server-functions.ts'

const nextIp = clientIps('100.64.3')

const signUp = (baseUrl: string, account: { name: string; email: string; password: string }, ip: string) =>
  callAuthFunction('signUp', { baseUrl, data: account, headers: { origin: baseUrl, 'x-forwarded-for': ip } })

const newAccount = () => ({
  name: 'Sign-up Test',
  email: `sign-up-${crypto.randomUUID()}@example.test`,
  password: `pw-${crypto.randomUUID()}`,
})

describe('closed sign-up', () => {
  it('has no sign-up endpoint', async () => {
    const { value } = await signUp(closedAppUrl, newAccount(), nextIp())
    expect(value).toEqual({ ok: false, failure: { code: 'NOT_FOUND' } })
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

  it('is not exposed over HTTP either', async () => {
    const res = await fetch(`${appUrl}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: appUrl, 'x-forwarded-for': nextIp() },
      body: JSON.stringify(newAccount()),
    })
    expect(res.status).toBe(404)
  })

  it('creates an account that cannot sign in before its address is verified', async () => {
    const account = newAccount()
    const { response, value } = await signUp(appUrl, account, nextIp())
    expect(value).toEqual({ ok: true, value: null })
    // No session before verification (requireEmailVerification, autoSignIn off).
    expect(
      response.headers.getSetCookie().filter((cookie) => cookie.includes('session_token=') && !/=;/.test(cookie)),
    ).toEqual([])
    const signIn = await postSignIn(account, { 'x-forwarded-for': nextIp() })
    expect(signIn.status).toBe(403)
    expect(await signIn.json()).toMatchObject({ code: 'EMAIL_NOT_VERIFIED' })
  })

  it('answers a sign-up for an existing address like any other (no account enumeration)', async () => {
    const fresh = await signUp(appUrl, newAccount(), nextIp())
    const taken = await signUp(appUrl, { ...newAccount(), email: users.other.email }, nextIp())
    expect([fresh.response.status, taken.response.status]).toEqual([200, 200])
    expect(taken.value).toEqual(fresh.value)
    expect(await taken.response.text()).toBe(await fresh.response.text())
  })
})
