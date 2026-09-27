// Content-Security-Policy of every kind of response: SSR pages (per-request nonce), the prerendered page
// (sha256 hashes), not-found pages, and responses that are not documents. Production build only.
// Error pages are covered by tests/integration/db-failure.test.ts, which needs its own server.
import { describe, expect, it } from 'vitest'
import { inlineSourceHashes } from '#/server/nitro/prerender-csp.ts'
import { appUrl, clientIps, signIn, users } from './helpers.ts'

const nextIp = clientIps('100.64.0')

const directive = (csp: string, name: string) =>
  csp
    .split(';')
    .map((part) => part.trim().split(/\s+/))
    .find(([key]) => key === name)
    ?.slice(1) ?? []

/** The policy must hold without any escape hatch and name only same-origin hosts. Returns it. */
const expectStrictPolicy = (res: Response, label: string) => {
  const csp = res.headers.get('content-security-policy') ?? ''
  expect(csp, label).not.toMatch(/'unsafe-(inline|eval|hashes)'|\*|https?:|data:[^;]*script/)
  expect(directive(csp, 'object-src'), label).toEqual(["'none'"])
  expect(directive(csp, 'base-uri'), label).toEqual(["'none'"])
  expect(directive(csp, 'frame-ancestors'), label).toEqual(["'none'"])
  return csp
}

const openTags = (html: string, tag: 'script' | 'style') =>
  [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>`, 'g'))].map((match) => match[0])

describe('content security policy', () => {
  it.each([
    ['/', 200],
    ['/login', 200],
    ['/no-such-page', 404],
  ])('SSR document %s carries a fresh nonce on every script and style', async (path, status) => {
    const res = await fetch(appUrl + path)
    expect(res.status).toBe(status)
    const csp = expectStrictPolicy(res, path)
    const nonce = csp.match(/'nonce-([^']+)'/)?.[1]
    expect(nonce, path).toMatch(/^[0-9a-f]{32}$/)
    expect(directive(csp, 'script-src')).toEqual(["'self'", `'nonce-${nonce}'`, "'strict-dynamic'"])
    expect(directive(csp, 'style-src')).toEqual(["'self'", `'nonce-${nonce}'`])
    const html = await res.text()
    // Throws on inline `style` or `on*` attributes, which neither a nonce nor a hash can allow.
    inlineSourceHashes(html)
    const tags = [...openTags(html, 'script'), ...openTags(html, 'style')]
    expect(tags.length).toBeGreaterThan(0)
    for (const tag of tags) expect(tag).toContain(`nonce="${nonce}"`)
    const again = (await fetch(appUrl + path)).headers.get('content-security-policy')
    expect(again).not.toContain(nonce!)
  })

  it('gives signed-in SSR pages the nonce policy too', async () => {
    const cookie = await signIn(users.author, nextIp())
    const res = await fetch(`${appUrl}/dashboard`, { headers: { cookie } })
    expect(res.status).toBe(200)
    const csp = expectStrictPolicy(res, '/dashboard')
    expect(csp).toContain("'nonce-")
  })

  it('allows exactly the inline scripts and styles of the prerendered page by hash', async () => {
    const res = await fetch(`${appUrl}/about`)
    expect(res.status).toBe(200)
    expect(res.headers.get('etag')).toBeTruthy()
    const csp = expectStrictPolicy(res, '/about')
    expect(csp).not.toContain("'nonce-")
    const { script, style } = inlineSourceHashes(await res.text())
    expect(script.length).toBeGreaterThan(0)
    expect(directive(csp, 'script-src').toSorted()).toEqual(["'self'", ...script].toSorted())
    expect(directive(csp, 'style-src').toSorted()).toEqual(["'self'", ...style].toSorted())
  })

  it.each([
    ['/api/health', 'GET'],
    ['/favicon.svg', 'GET'],
    ['/_serverFn/does-not-exist', 'GET'],
  ])('locks down %s, which is not a document', async (path, method) => {
    const res = await fetch(appUrl + path, { method })
    expect(res.headers.get('content-type')).not.toMatch(/text\/html/)
    expect(res.headers.get('content-security-policy')).toBe(
      "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    )
  })
})
