// What an authed SSR page costs in session lookups, inside a real Start request context (`requestHandler`, which
// Start wraps around every request): the `_authed` guard's read (requestSession, what getSession in
// src/lib/session.functions.ts runs) and then the dashboard loader's API call through the in-process client, whose
// Authentication middleware asks for the same cookie's session. Counted at pg's Client (helpers.ts).
import { getRequestHeaders, requestHandler } from '@tanstack/react-start/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { myPostsCreate, myPostsList } from '#/sdk/sdk.gen.ts'
import { createInProcessApiClient } from '#/server/api/in-process-client.ts'
import { auth } from '#/server/auth.ts'
import { pool } from '#/server/db/client.ts'
import { env } from '#/server/env.ts'
import { requestSession } from '#/server/http/request-session.ts'
import { createAccount, expectBudget, statementsOf } from './helpers.ts'

afterAll(() => pool.end())

const signIn = async (label: string) => {
  const account = await createAccount(label)
  const response = await auth.handler(
    new Request(`${env.appUrl}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: env.appUrl },
      body: JSON.stringify({ email: account.email, password: account.password }),
    }),
  )
  expect(response.status).toBe(200)
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0]!)
    .join('; ')
}

/** Runs `work` as Start runs a request for `/dashboard` with `cookie`, and returns what `work` returned. */
const serve = async <T>(cookie: string, work: () => Promise<T>): Promise<T> => {
  const results: T[] = []
  await requestHandler(async () => {
    results.push(await work())
    return new Response(null, { status: 204 })
  })(new Request(`${env.appUrl}/dashboard`, { headers: { cookie } }), {})
  return results[0]!
}

const touchesSession = (sql: string) => sql.includes('"session"')

let cookie: string
let otherCookie: string
let lookup: number
beforeAll(async () => {
  ;[cookie, otherCookie] = await Promise.all([signIn('ssr-session'), signIn('ssr-session-other')])
  // What one lookup costs outside any request: the budget of a whole page below.
  const { statements } = await statementsOf(() => auth.api.getSession({ headers: new Headers({ cookie }) }))
  lookup = statements.length
  expect(statements.some((sql) => touchesSession(sql))).toBe(true)
})

describe('an authed SSR page', () => {
  it('looks the session up once for the guard and the API calls of its loaders together', async () => {
    const { result, statements } = await statementsOf(() =>
      serve(cookie, async () => {
        const guard = await requestSession(getRequestHeaders())
        const page = await myPostsList({ client: createInProcessApiClient() })
        return { signedIn: guard !== null, status: page.response?.status }
      }),
    )
    expect(result).toEqual({ signedIn: true, status: 200 })
    // The list itself is one more statement (tests/db/query-budget.test.ts).
    expectBudget('an authed SSR page', statements, lookup + 1)
  })

  it('keeps lookups apart per request and per cookie', async () => {
    const twice = await statementsOf(async () => {
      await serve(cookie, () => requestSession(getRequestHeaders()))
      await serve(cookie, () => requestSession(getRequestHeaders()))
    })
    expectBudget('two requests', twice.statements, 2 * lookup)

    const { result, statements } = await statementsOf(() =>
      serve(cookie, async () => {
        const [mine, theirs] = await Promise.all([
          requestSession(new Headers({ cookie })),
          requestSession(new Headers({ cookie: otherCookie })),
        ])
        return [mine?.user.email, theirs?.user.email]
      }),
    )
    expect(new Set(result).size).toBe(2)
    expectBudget('two cookies in one request', statements, 2 * lookup)
  })

  it('refuses a write through the in-process client before it reaches the API', async () => {
    const { result, statements } = await statementsOf(() =>
      serve(cookie, () =>
        // The SDK hands a thrown fetch back as `error` (query options set throwOnError, and then it throws).
        myPostsCreate({ client: createInProcessApiClient(), body: { body: 'never written' } }).then(({ error }) =>
          error instanceof Error ? error.message : 'sent',
        ),
      ),
    )
    expect(result).toMatch(/^The in-process API client only sends GET \(got POST \/api\/me\/posts\)/)
    expectBudget('a refused write', statements, 0)
  })
})
