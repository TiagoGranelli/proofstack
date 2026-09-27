// Exercises the generated SDK against the running app and a real, freshly migrated Postgres.
// Run through `pnpm verify:app`, which starts the server and provides APP_URL and two test authors.
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { createClient } from '#/sdk/client/index.ts'
import { meGet, systemHealth, systemReady } from '#/sdk/sdk.gen.ts'
import { appUrl, clientIps, sdkClient, signIn, users } from './helpers.ts'

const nextIp = clientIps('192.0.2')
const anonymous = sdkClient()
let authorCookie: string

beforeAll(async () => {
  authorCookie = await signIn(users.author, nextIp())
})

describe('contract', () => {
  it('serves exactly the committed openapi.json', async () => {
    const served: unknown = await (await fetch(`${appUrl}/api/openapi.json`)).json()
    expect(served).toEqual(JSON.parse(readFileSync('openapi.json', 'utf8')))
  })

  it('documents cookie auth on private operations and 400 only where there is a body or a query', () => {
    type Operation = {
      security?: Array<Record<string, string[]>>
      responses: Record<string, unknown>
      requestBody?: unknown
      parameters?: unknown[]
    }
    const spec = JSON.parse(readFileSync('openapi.json', 'utf8')) as {
      paths: Record<string, Record<string, Operation>>
      components: {
        schemas: Record<string, unknown>
        securitySchemes?: Record<string, { type: string; in?: string; name?: string }>
      }
    }
    const schemes = spec.components.securitySchemes ?? {}
    expect(
      Object.values(schemes)
        .map((s) => `${s.type} ${s.in} ${s.name}`)
        .toSorted(),
    ).toEqual(['apiKey cookie __Secure-better-auth.session_token', 'apiKey cookie better-auth.session_token'])
    // Generated names like Post_1 mean two schemas collided; the SDK types would get unstable names.
    expect(Object.keys(spec.components.schemas).filter((name) => /_\d+$/.test(name))).toEqual([])
    const operations = Object.entries(spec.paths).flatMap(([path, ops]) =>
      Object.entries(ops).map(([method, op]) => ({ id: `${method.toUpperCase()} ${path}`, path, op })),
    )
    expect(operations.length).toBeGreaterThan(0)
    for (const { id, path, op } of operations) {
      const alternatives = (op.security ?? []).flatMap((requirement) => Object.keys(requirement)).toSorted()
      const privatePath = path === '/api/me' || path.startsWith('/api/me/')
      expect(alternatives, id).toEqual(privatePath ? Object.keys(schemes).toSorted() : [])
      // A path id is any string (a malformed one answers like a missing one), so it never makes a 400.
      const query = (op.parameters ?? []).filter((parameter) => (parameter as { in: string }).in === 'query')
      const hasInput = op.requestBody !== undefined || query.length > 0
      expect('400' in op.responses, id).toBe(hasInput)
    }
  })

  it('reports liveness and readiness', async () => {
    expect((await systemHealth({ client: anonymous })).data).toEqual({ status: 'ok' })
    expect((await systemReady({ client: anonymous })).data).toEqual({ status: 'ok' })
  })
})

describe('me', () => {
  it('answers the signed-in user, without credentials or session data', async () => {
    const { data, response } = await meGet({ client: sdkClient(authorCookie) })
    expect(response?.status).toBe(200)
    expect(Object.keys(data ?? {}).toSorted()).toEqual(['email', 'id', 'name'])
    expect(data).toMatchObject({ name: users.author.name, email: users.author.email })
    expect(response?.headers.get('cache-control')).toBe('no-store')
  })

  it('answers 401 without a session or with a forged one', async () => {
    for (const cookie of [undefined, 'better-auth.session_token=forged.token']) {
      const client = createClient({ baseUrl: appUrl, headers: cookie ? { cookie } : {} })
      const { error, response } = await meGet({ client })
      expect(response?.status, cookie ?? 'no cookie').toBe(401)
      expect(error).toEqual({ _tag: 'Unauthorized', message: 'Authentication required' })
    }
  })
})

describe('security', () => {
  // The CSRF check in src/start.ts runs before routing, so it answers for any /api path and method.
  const attempts: Array<[string, Record<string, string>]> = [
    ['cross-site fetch metadata', { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }],
    // Older browsers and non-browser clients send no Sec-Fetch-Site: Origin alone must decide.
    ['a foreign Origin without fetch metadata', { origin: 'https://evil.example' }],
    ['no Origin, Referer or fetch metadata', {}],
  ]

  it.each(attempts)('rejects /api writes with %s before they reach the API', async (_, headers) => {
    for (const method of ['POST', 'PATCH', 'DELETE']) {
      const res = await fetch(`${appUrl}/api/me`, {
        method,
        headers: { cookie: authorCookie, 'content-type': 'application/json', ...headers },
        body: '{}',
      })
      expect(res.status, method).toBe(403)
    }
  })

  it('lets the same writes from our own origin through to the API', async () => {
    const res = await fetch(`${appUrl}/api/me`, {
      method: 'POST',
      headers: { cookie: authorCookie, 'content-type': 'application/json', origin: appUrl },
      body: '{}',
    })
    // GET is the only method of /api/me: the router, not the CSRF check, refuses it.
    expect(res.status).not.toBe(403)
    expect(res.status).toBeGreaterThanOrEqual(400)
  })

  it('sends security headers and keeps private pages out of shared caches', async () => {
    const home = await fetch(appUrl)
    expect(home.headers.get('x-content-type-options')).toBe('nosniff')
    expect(home.headers.get('x-frame-options')).toBe('DENY')
    // Public but rendered per request: revalidate every time, never stored by shared caches.
    expect(home.headers.get('cache-control')).toBe('private, no-cache')
    const dashboard = await fetch(`${appUrl}/dashboard`, { headers: { cookie: authorCookie } })
    expect(dashboard.status).toBe(200)
    expect(dashboard.headers.get('cache-control')).toContain('no-store')
  })
})
