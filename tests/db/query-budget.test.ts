// Query budgets against real Postgres: each repository method, and each server path that reads a list of
// rows, issues a fixed number of SQL statements whatever the data size. An N+1 (a query per row) fails here
// with the method's name and the statements it sent. A new repository method gets a budget here, or in a file
// of its own next to this one.
import { Effect, Layer } from 'effect'
import { afterAll, describe, expect, it } from 'vitest'
import { auth } from '#/server/auth.ts'
import { pool } from '#/server/db/client.ts'
import { DatabaseHealth } from '#/server/db/health.ts'
import { env } from '#/server/env.ts'
import { createAccount, expectBudget, recordingDatabase, statementsOf, withBudget } from './helpers.ts'

afterAll(() => pool.end())

describe('DatabaseHealth', () => {
  it('pings in one statement', async () => {
    const health = DatabaseHealth.layer.pipe(Layer.provide(recordingDatabase))
    const ping = Effect.gen(function* () {
      return yield* (yield* DatabaseHealth).ping
    })
    await expect(withBudget('ping', 1, ping.pipe(Effect.provide(health)))).resolves.toBeUndefined()
  })
})

/** A request to Better Auth's router as a signed-in browser of this app would send it. */
const request = (path: string, cookie: string, method: 'GET' | 'POST', body: Record<string, unknown> = {}) =>
  auth.handler(
    new Request(`${env.appUrl}/api/auth${path}`, {
      method,
      headers: {
        cookie,
        origin: env.appUrl,
        ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
      },
      ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
    }),
  )

/** An account signed in once (the cookie's session), plus `others` more sessions. */
const signedIn = async (others: number) => {
  const account = await createAccount(`sessions-${others}`)
  const response = await auth.handler(
    new Request(`${env.appUrl}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: env.appUrl },
      body: JSON.stringify({ email: account.email, password: account.password }),
    }),
  )
  expect(response.status).toBe(200)
  const cookie = response.headers
    .getSetCookie()
    .map((c) => c.split(';')[0]!)
    .join('; ')
  const context = await auth.$context
  for (let i = 0; i < others; i++) await context.internalAdapter.createSession(account.id)
  return { cookie, password: account.password }
}

/**
 * Better Auth's session endpoints behind the account page (listSessions, revokeSession and the sign-out
 * actions in src/lib/auth.functions.ts, which map the listed rows in memory), called through its router like
 * callAuthEndpoint does. Counted at pg's Client, which Better Auth's Drizzle adapter uses.
 */
describe('session endpoints', () => {
  /**
   * Statements each endpoint may send for an account with the cookie's session plus `others` more. Better Auth
   * 1.7.6 revokes other sessions one by one (a lookup and a delete per session, `Promise.all` over
   * `internalAdapter.deleteSession` in its /revoke-other-sessions): a known upstream N+1, budgeted as it is so
   * that it cannot grow unnoticed and a fix upstream shows up here. The others are constant.
   */
  const BUDGETS = {
    'GET /list-sessions': () => 3,
    'POST /revoke-sessions': () => 4,
    'POST /revoke-other-sessions': (others: number) => 3 + 2 * others,
    // changePassword in src/lib/auth.functions.ts always signs the other sessions out with it.
    'POST /change-password': () => 7,
  }
  const bodies: Partial<Record<keyof typeof BUDGETS, (password: string) => Record<string, unknown>>> = {
    'POST /change-password': (password) => ({
      currentPassword: password,
      newPassword: `new-${password}`,
      revokeOtherSessions: true,
    }),
  }

  it('lists the cookie session and the others, so the budgets below count 1 session and 21', async () => {
    for (const others of [0, 20]) {
      const { cookie } = await signedIn(others)
      expect(await (await request('/list-sessions', cookie, 'GET')).json()).toHaveLength(others + 1)
    }
  })

  it.each(Object.keys(BUDGETS) as Array<keyof typeof BUDGETS>)(
    'answers %s within its budget for 1 session and for 21',
    async (what) => {
      const [method, path] = what.split(' ') as ['GET' | 'POST', string]
      for (const others of [0, 20]) {
        const { cookie, password } = await signedIn(others)
        const body = bodies[what]?.(password)
        const { result, statements } = await statementsOf(() => request(path, cookie, method, body))
        expect(result.status, `${what} with ${others + 1} sessions`).toBe(200)
        expectBudget(`${what} with ${others + 1} sessions`, statements, BUDGETS[what](others))
      }
    },
  )
})
