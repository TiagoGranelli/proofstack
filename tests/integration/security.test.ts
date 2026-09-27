// Security behavior of the running app: headers and CSP, CSRF, the Better Auth surface, sessions,
// request limits and sign-in rate limiting. Run through `pnpm verify:app` (production build).
import { beforeAll, describe, expect, it } from 'vitest'
import { appUrl, clientIps, postSignIn, sessionCookie, signIn, users } from './helpers.ts'

const nextIp = clientIps('198.51.100')
const { email, password } = users.author
// CSP, the static-file headers and rate limiting are production-only.
const production = process.env.NODE_ENV === 'production'

const me = (cookie: string) => fetch(`${appUrl}/api/me/posts`, { headers: { cookie } })

let cookie: string

beforeAll(async () => {
  cookie = await signIn(users.author, nextIp())
})

describe('headers', () => {
  it.runIf(production)('gives SSR pages a nonce-based CSP that covers every script', async () => {
    const res = await fetch(appUrl)
    const csp = res.headers.get('content-security-policy') ?? ''
    const nonce = csp.match(/script-src 'self' 'nonce-([^']+)'/)?.[1]
    expect(nonce).toBeTruthy()
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-(inline|eval)'/)
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("object-src 'none'")
    // E2E Firefox runs with COOP enforcement off (playwright.config.ts), so the header is only checked here.
    expect(res.headers.get('cross-origin-opener-policy')).toBe('same-origin')
    const scripts = [...(await res.text()).matchAll(/<script\b[^>]*>/g)].map((m) => m[0])
    expect(scripts.length).toBeGreaterThan(0)
    for (const tag of scripts) expect(tag).toContain(`nonce="${nonce}"`)
    const again = (await fetch(appUrl)).headers.get('content-security-policy')
    expect(again).not.toContain(nonce!)
  })

  it.runIf(production)('sends security headers on static files and prerendered pages too', async () => {
    for (const path of ['/about', '/favicon.svg']) {
      const res = await fetch(appUrl + path)
      expect(res.status, path).toBe(200)
      expect(res.headers.get('x-content-type-options'), path).toBe('nosniff')
      expect(res.headers.get('x-frame-options'), path).toBe('DENY')
      expect(res.headers.get('cross-origin-opener-policy'), path).toBe('same-origin')
      expect(res.headers.get('content-security-policy'), path).toContain("frame-ancestors 'none'")
    }
  })

  it('keeps per-user API responses out of caches', async () => {
    const res = await me(cookie)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })
})

describe('csrf', () => {
  const attempts: Array<[string, Record<string, string>]> = [
    ['cross-site fetch metadata, even with our origin', { origin: appUrl, 'sec-fetch-site': 'cross-site' }],
    ['same-site (sibling subdomain)', { origin: appUrl, 'sec-fetch-site': 'same-site' }],
    ['foreign origin', { origin: 'https://evil.example' }],
    ['no origin, referer or fetch metadata', {}],
  ]
  it.each(attempts)('rejects sign-in with %s', async (_, headers) => {
    const res = await fetch(`${appUrl}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': nextIp(), ...headers },
      body: JSON.stringify({ email, password }),
    })
    expect(res.status).toBe(403)
  })

  it('rejects cross-site server function calls before they run', async () => {
    const res = await fetch(`${appUrl}/_serverFn/anything`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example', cookie },
      body: '{}',
    })
    expect(res.status).toBe(403)
  })
})

describe('auth surface', () => {
  // Better Auth endpoints the app does not use (the allowlist in src/server/http/auth-endpoints.ts), and
  // method or path variants of ones it does. Sign-up's absence with AUTH_SIGN_UP=closed: auth-sign-up.test.ts.
  const unused = [
    ['POST', '/sign-in/social'],
    ['POST', '/update-user'],
    ['POST', '/change-email'],
    ['POST', '/verify-password'],
    ['POST', '/set-password'],
    ['GET', '/reset-password/some-token'],
    ['GET', '/delete-user/callback?token=x'],
    ['GET', '/callback/github'],
    ['GET', '/list-accounts'],
    ['POST', '/update-session'],
    ['GET', '/sign-out'],
    ['POST', '/get-session'],
    ['POST', '/sign-in/email/'],
    ['POST', '/list-sessions'],
    ['GET', '/revoke-sessions'],
  ] as const
  // Sent without a session: an exposed endpoint then answers 400/401 instead of 404, and a regression that
  // re-exposes e.g. /update-user cannot change the users other tests are using.
  it.each(unused)('%s %s is not exposed', async (method, path) => {
    const res = await fetch(`${appUrl}/api/auth${path}`, {
      method,
      headers: { 'content-type': 'application/json', origin: appUrl, 'x-forwarded-for': nextIp() },
      ...(method === 'POST' ? { body: '{}' } : {}),
    })
    expect(res.status).toBe(404)
  })

  it('exposes the session to its owner through GET /get-session', async () => {
    const res = await fetch(`${appUrl}/api/auth/get-session`, { headers: { cookie, 'x-forwarded-for': nextIp() } })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toContain('no-store')
    expect((await res.json()) as unknown).toMatchObject({ user: { email } })
  })
})

const postTo = (path: string, body: BodyInit) =>
  fetch(appUrl + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: appUrl },
    body,
    duplex: 'half',
  } as RequestInit)

describe('requests', () => {
  it('rejects bodies over 64 KiB and bodies without a length', async () => {
    expect((await postTo('/api/posts', JSON.stringify({ body: 'x'.repeat(70_000) }))).status).toBe(413)
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"body":"x"}'))
        controller.close()
      },
    })
    expect((await postTo('/api/posts', stream)).status).toBe(411)
  })

  it('does not leak internals in error responses', async () => {
    const res = await fetch(`${appUrl}/api/me/posts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: appUrl, cookie },
      body: '{',
    })
    expect(res.status).toBe(400)
    const unknownFn = await fetch(`${appUrl}/_serverFn/does-not-exist`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: appUrl },
      body: '{}',
    })
    for (const text of [await res.text(), await unknownFn.text()]) {
      expect(text).not.toMatch(/\bat .+:\d+:\d+|node_modules|\.mjs|select |postgres/i)
    }
  })

  // Start answers an unknown id with a bare 500 until TanStack/router#8246 ships; then this expects 404
  // (ADR 0009).
  it('answers an unknown server function with an error that leaks nothing', async () => {
    const get = await fetch(`${appUrl}/_serverFn/does-not-exist`)
    const post = await fetch(`${appUrl}/_serverFn/does-not-exist`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: appUrl },
      body: '{}',
    })
    for (const res of [get, post]) {
      expect(res.status).toBeGreaterThanOrEqual(400)
      expect(await res.text()).not.toMatch(/does-not-exist|Server function|\bat .+:\d+:\d+|node_modules|\.mjs/)
    }
  })

  it('does not redirect to other hosts', async () => {
    const targets = await Promise.all(
      ['//evil.example/', '/\\evil.example'].map(async (path) => {
        const location = (await fetch(appUrl + path, { redirect: 'manual' })).headers.get('location')
        return location ? new URL(location, appUrl).origin : new URL(appUrl).origin
      }),
    )
    expect(targets).toEqual([new URL(appUrl).origin, new URL(appUrl).origin])
  })
})

describe('sessions', () => {
  it('answers unknown emails and wrong passwords identically', async () => {
    const ip = nextIp()
    const unknown = await postSignIn(
      { email: `nobody-${crypto.randomUUID()}@example.test`, password: 'wrong-password-123' },
      { 'x-forwarded-for': ip },
    )
    const wrong = await postSignIn({ email, password: 'wrong-password-123' }, { 'x-forwarded-for': ip })
    expect(unknown.status).toBe(401)
    expect(wrong.status).toBe(401)
    expect(await unknown.json()).toEqual(await wrong.json())
  })

  it.runIf(production)('limits sign-in to 3 attempts per 10 s per client IP', async () => {
    const client = nextIp()
    const attempts: Response[] = []
    for (let attempt = 0; attempt < 4; attempt++)
      attempts.push(await postSignIn({ email, password: 'wrong-password-123' }, { 'x-forwarded-for': client }))
    expect(attempts.map((res) => res.status)).toEqual([401, 401, 401, 429])
    expect(Number(attempts[3]!.headers.get('x-retry-after'))).toBeLessThanOrEqual(10)

    // The test process is the trusted proxy and its value is the last hop it vouches for: addresses prepended
    // in front of it neither reset the bucket nor move it, even with the right password.
    const forgeries: Array<Record<string, string> & { 'x-forwarded-for': string }> = [
      { 'x-forwarded-for': `203.0.113.7, ${client}` },
      { 'x-forwarded-for': `203.0.113.8, 198.18.0.9, ${client}` },
    ]
    for (const headers of forgeries)
      expect((await postSignIn({ email, password }, headers)).status, JSON.stringify(headers)).toBe(429)

    // Another client is unaffected.
    const res = await postSignIn({ email, password }, { 'x-forwarded-for': nextIp() })
    expect(res.status).toBe(200)
  })

  it('signs in while the browser still sends a stale session cookie', async () => {
    for (const stale of ['better-auth.session_token=stale.not-a-valid-signature', cookie]) {
      const res = await postSignIn({ email, password }, { 'x-forwarded-for': nextIp(), cookie: stale })
      expect(res.status).toBe(200)
      // The last session cookie wins in the browser; it must be a new, working session.
      const next = sessionCookie(res)!
      expect(next).toBeTruthy()
      expect(next).not.toBe(stale)
      expect((await me(next)).status).toBe(200)
    }
  })

  it('ends the session on sign-out', async () => {
    const session = await signIn(users.author, nextIp())
    expect((await me(session)).status).toBe(200)
    const out = await fetch(`${appUrl}/api/auth/sign-out`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: appUrl, cookie: session, 'x-forwarded-for': nextIp() },
      body: '{}',
    })
    expect(out.status).toBe(200)
    expect((await me(session)).status).toBe(401)
    // Other sessions of the same user are not affected.
    expect((await me(cookie)).status).toBe(200)
  })
})
