// Database failures must not leak. This file starts its own server (the built app) on its own database,
// signs in, then renames the `user` and `session` tables so every query that carries an email or a session
// token fails inside Postgres. Drizzle puts the failed query's parameters into its error message, so any
// raw error that reached a response or the log would show them. Production build only.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type RunningApp, startApp } from '../../scripts/app-server.ts'
import { dropTestDatabase, testDatabaseUrl } from '../../scripts/test-db.ts'

const production = process.env.NODE_ENV === 'production'
const LOG_FILE = 'test-results/app-server-db-failure.log'

let app: RunningApp
let cookie: string
let token: string
let databaseUrl: string

/** Everything a leak would consist of: credentials, the session token, and database internals. */
const secrets = () => [app.user.email, app.user.password, app.otherUser.email, token]
const expectNoLeak = (text: string, label: string) => {
  for (const secret of secrets()) expect(text.includes(secret), `${label} contains a secret`).toBe(false)
  expect(text, label).not.toMatch(/Failed query|relation "|_offline|Failed to get session|node_modules|\.mjs:\d+/)
}

/** Ids of the server functions the client bundle can call (Start compiles each to a sha256 id). */
const serverFunctionIds = () => {
  const dir = '.output/public/assets'
  const ids = new Set<string>()
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.js')))
    for (const [, id] of readFileSync(join(dir, file), 'utf8').matchAll(/[`'"]([0-9a-f]{64})[`'"]/g)) ids.add(id!)
  return [...ids]
}

describe.runIf(production)('database failure', () => {
  beforeAll(async () => {
    databaseUrl = testDatabaseUrl('dbfail')
    app = await startApp({ databaseUrl, logFile: LOG_FILE })
    const res = await fetch(`${app.url}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: app.url },
      body: JSON.stringify({ email: app.user.email, password: app.user.password }),
    })
    expect(res.status).toBe(200)
    cookie = res.headers
      .getSetCookie()
      .map((c) => c.split(';')[0]!)
      .find((c) => /session_token=./.test(c))!
    token = decodeURIComponent(cookie.split('=')[1]!).split('.')[0]!
    expect(token.length).toBeGreaterThan(10)

    const db = new Client({ connectionString: databaseUrl })
    await db.connect()
    await db.query('alter table "user" rename to user_offline; alter table "session" rename to session_offline')
    await db.end()
  }, 60_000)

  afterAll(async () => {
    await app?.stop()
    if (databaseUrl) await dropTestDatabase(databaseUrl)
  })

  it('answers server functions with a generic error', async () => {
    const ids = serverFunctionIds()
    expect(ids.length).toBeGreaterThan(0)
    const bodies: string[] = []
    for (const id of ids) {
      const url = `${app.url}/_serverFn/${id}`
      const headers = { cookie, origin: app.url, 'x-tsr-serverFn': 'true' }
      let res = await fetch(url, { headers })
      if (res.status === 405)
        res = await fetch(url, {
          method: 'POST',
          headers: { ...headers, 'content-type': 'application/json' },
          body: '{}',
        })
      const text = await res.text()
      expectNoLeak(text, `server function ${id}`)
      bodies.push(text)
    }
    // At least the session check (src/lib/session.functions.ts) reached the database and failed.
    expect(bodies.some((text) => text.includes('Internal error'))).toBe(true)
  })

  it('answers the API and Better Auth with an empty 500', async () => {
    const api = await fetch(`${app.url}/api/me/posts`, { headers: { cookie } })
    expect(api.status).toBe(500)
    expectNoLeak(await api.text(), 'GET /api/me/posts')

    const signIn = await fetch(`${app.url}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: app.url },
      body: JSON.stringify({ email: app.user.email, password: app.user.password }),
    })
    expect(signIn.status).toBe(500)
    expectNoLeak(await signIn.text(), 'POST /api/auth/sign-in/email')
  })

  it('renders the error page without details', async () => {
    const res = await fetch(`${app.url}/dashboard`, { headers: { cookie } })
    expect(res.status).toBe(500)
    const html = await res.text()
    expect(html).toContain('This page could not be loaded')
    expectNoLeak(html, 'GET /dashboard')
  })

  it('logs the failures as JSON lines without parameters', async () => {
    await app.stop()
    const log = readFileSync(LOG_FILE, 'utf8')
    for (const secret of secrets()) expect(log.includes(secret), 'the server log contains a secret').toBe(false)
    expect(log).not.toMatch(/params:/)
    const lines = log.split('\n').filter((line) => line.startsWith('{'))
    const messages = lines.map((line) => (JSON.parse(line) as { msg: string }).msg)
    expect(messages).toEqual(expect.arrayContaining(['server function failed', 'api defect', 'auth request failed']))
  })
})
