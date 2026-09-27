// The client IP Better Auth records and rate-limits by (advanced.ipAddress.trustedProxies). The main server
// trusts loopback, so the X-Forwarded-For the test process sends is believed. The closed-sign-up server trusts
// only 10.0.0.0/8: the same header from 127.0.0.1 must be ignored, in the session and in the rate limit.
import { describe, expect, it } from 'vitest'
import { appUrl, closedAppUrl, postSignIn, sessionCookie, users } from './helpers.ts'
import { callAuthFunction } from './server-functions.ts'

const { email, password } = users.author

/** The client IP Better Auth stored on the session the cookie belongs to, as the account page lists it. */
const sessionIp = async (baseUrl: string, cookie: string) => {
  const { value } = await callAuthFunction('listSessions', { method: 'GET', baseUrl, headers: { cookie } })
  expect(value?.ok).toBe(true)
  return value?.ok ? value.value.find((session) => session.current)?.ipAddress : undefined
}

describe('client IP behind a trusted proxy', () => {
  it('is the last X-Forwarded-For hop the trusted peer vouches for', async () => {
    const res = await postSignIn(users.author, { 'x-forwarded-for': '203.0.113.50, 100.64.1.7' })
    expect(res.status).toBe(200)
    expect(await sessionIp(appUrl, sessionCookie(res)!)).toBe('100.64.1.7')
  })
})

describe('client IP from a peer outside TRUSTED_PROXIES', () => {
  // Connect over IPv4 loopback, so the peer is 127.0.0.1 whatever `localhost` resolves to. Origin stays the
  // server's APP_URL, as a browser on that origin would send it.
  const direct = new URL(closedAppUrl)
  direct.hostname = '127.0.0.1'
  const signIn = (spoofed: string, pass = password) =>
    fetch(`${direct.origin}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: closedAppUrl, 'x-forwarded-for': spoofed },
      body: JSON.stringify({ email, password: pass }),
    })

  // The only test that signs in on this server: every request lands in the one bucket of 127.0.0.1.
  it('ignores a spoofed X-Forwarded-For for the session and the sign-in rate limit', async () => {
    const res = await signIn('100.64.1.99')
    expect(res.status).toBe(200)
    expect(await sessionIp(direct.origin, sessionCookie(res)!)).toBe('127.0.0.1')

    // Each attempt claims another address; all of them count against 127.0.0.1 (3 per 10 s, 1 already used).
    const statuses: number[] = []
    for (const spoofed of ['100.64.1.100', '100.64.1.101, 10.0.0.1', '100.64.1.102'])
      statuses.push((await signIn(spoofed, 'wrong-password-123')).status)
    expect(statuses).toEqual([401, 401, 429])
  })
})
