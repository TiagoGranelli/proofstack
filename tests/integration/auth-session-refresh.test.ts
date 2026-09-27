// A session older than Better Auth's updateAge (1 day of its 7) is renewed on use, and the renewed cookie
// reaches the client on both paths that read the session: the Effect API's Authentication middleware
// (/api/me) and Better Auth's own /get-session.
import { Pool } from 'pg'
import { afterAll, describe, expect, it } from 'vitest'
import { appUrl, clientIps, sessionCookie, signIn, users } from './helpers.ts'

const nextIp = clientIps('100.64.4')
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
afterAll(() => pool.end())

const DAY = 24 * 60 * 60 * 1000
const tokenOf = (cookie: string) => decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1)).split('.')[0]!

/** A fresh session, aged: it expires in one hour, so more than updateAge has passed since it was renewed. */
const agedSession = async () => {
  const cookie = await signIn(users.author, nextIp())
  const { rowCount } = await pool.query(
    `update session set expires_at = now() + interval '1 hour', updated_at = now() - interval '6 days' where token = $1`,
    [tokenOf(cookie)],
  )
  expect(rowCount).toBe(1)
  return cookie
}

const expiresAt = async (cookie: string) =>
  (await pool.query<{ expires_at: Date }>('select expires_at from session where token = $1', [tokenOf(cookie)]))
    .rows[0]!.expires_at

/** The renewed session cookie on a response: same token, a full 7-day lifetime again. */
const expectRenewedCookie = (res: Response, cookie: string) => {
  const renewed = sessionCookie(res)
  expect(renewed, 'Set-Cookie with the session token').toBeTruthy()
  expect(tokenOf(renewed!)).toBe(tokenOf(cookie))
  const header = res.headers.getSetCookie().find((value) => value.startsWith(renewed!))!
  expect(Number(header.match(/Max-Age=(\d+)/i)?.[1])).toBeGreaterThan(6 * 24 * 60 * 60)
}

describe('session refresh', () => {
  it('renews an aged session used through the Effect API middleware', async () => {
    const cookie = await agedSession()
    const res = await fetch(`${appUrl}/api/me`, { headers: { cookie } })
    expect(res.status).toBe(200)
    expectRenewedCookie(res, cookie)
    expect((await expiresAt(cookie)).getTime()).toBeGreaterThan(Date.now() + 6 * DAY)
  })

  it('renews an aged session read through /get-session', async () => {
    const cookie = await agedSession()
    const res = await fetch(`${appUrl}/api/auth/get-session`, { headers: { cookie } })
    expect(res.status).toBe(200)
    expectRenewedCookie(res, cookie)
    expect((await expiresAt(cookie)).getTime()).toBeGreaterThan(Date.now() + 6 * DAY)
  })

  it('leaves a recent session alone', async () => {
    const cookie = await signIn(users.author, nextIp())
    const before = await expiresAt(cookie)
    const res = await fetch(`${appUrl}/api/me`, { headers: { cookie } })
    expect(res.status).toBe(200)
    expect(sessionCookie(res)).toBeUndefined()
    expect(await expiresAt(cookie)).toEqual(before)
  })
})
