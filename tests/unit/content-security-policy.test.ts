// The Content-Security-Policy of every HTML document (src/lib/content-security-policy.ts, ADR 0010). The
// E2E suite proves browsers load the app under it (tests/e2e/csp.spec.ts); this pins each directive, so a
// loosened one (an 'unsafe-inline', a wildcard, a dropped frame-ancestors) is a failing diff here.
import { describe, expect, it } from 'vitest'
import { documentHeaders, nonceSources } from '#/lib/content-security-policy.ts'

const directives = (policy: string) => policy.split('; ')

describe('documentHeaders', () => {
  it('allows only this origin plus the given sources, and forbids plugins, base, framing and foreign forms', () => {
    const { 'content-security-policy': policy } = documentHeaders({
      script: ["'sha256-abc'", "'sha256-def'"],
      style: ["'sha256-ghi'"],
    })
    expect(directives(policy)).toEqual([
      "default-src 'self'",
      "script-src 'self' 'sha256-abc' 'sha256-def'",
      "style-src 'self' 'sha256-ghi'",
      "img-src 'self' data:",
      "font-src 'self'",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ])
  })

  it('falls back to this origin alone when a page has no inline sources', () => {
    const { 'content-security-policy': policy } = documentHeaders({ script: [], style: [] })
    expect(directives(policy)).toContain("script-src 'self'")
    expect(directives(policy)).toContain("style-src 'self'")
  })
})

describe('nonceSources', () => {
  it('gives scripts the nonce and strict-dynamic, and styles the nonce, never unsafe-inline', () => {
    const sources = nonceSources('r4nd0m')
    expect(sources).toEqual({ script: ["'nonce-r4nd0m'", "'strict-dynamic'"], style: ["'nonce-r4nd0m'"] })
    const { 'content-security-policy': policy } = documentHeaders(sources)
    expect(directives(policy)).toContain("script-src 'self' 'nonce-r4nd0m' 'strict-dynamic'")
    expect(policy).not.toMatch(/unsafe-inline|unsafe-eval|\*/)
  })
})
