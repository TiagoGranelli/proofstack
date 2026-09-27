// safeRedirect decides where `?redirect=` may send a user after sign-in. Pure function: no app needed.
import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { safeRedirect } from '#/features/auth/utils/safe-redirect.ts'

const DEFAULT = '/dashboard'

describe('safeRedirect', () => {
  const rejected: Array<[string, unknown]> = [
    ['not a string', 42],
    ['undefined', undefined],
    ['empty', ''],
    ['relative path', 'dashboard'],
    // The attack this module must refuse, as test data.
    // oxlint-disable-next-line no-script-url
    ['javascript: URL', 'javascript:alert(1)'],
    ['data: URL', 'data:text/html,<script>alert(1)</script>'],
    ['absolute URL', 'https://evil.example/'],
    ['scheme-relative URL', '//evil.example/'],
    ['triple slash', '///evil.example/'],
    ['scheme-relative URL with an unparsable host', '//['],
    ['backslash host', '/\\evil.example'],
    ['backslash anywhere', '/a\\b'],
    ['tab inside the host', '/\t/evil.example'],
    ['newline inside the host', '/\n/evil.example'],
    ['dot segment to //host', '/.//evil.example'],
    ['parent segment to //host', '/a/..//evil.example'],
    ['encoded dot to //host', '/%2e//evil.example'],
    ['encoded dots to //host', '/%2E%2E//evil.example'],
    ['encoded slash to //host', '/%2F/evil.example'],
    ['encoded backslash', '/%5Cevil.example'],
    ['lower-case encoded backslash', '/%5cevil.example'],
    ['malformed percent-encoding', '/%E0%A4%A'],
    // Found by the properties below: each is //evil.example once something decodes the path one more time.
    ['an encoded tab before the host', '/%09/evil.example'],
    ['an encoded newline before the host', '/%0a/evil.example'],
    ['a dot segment that appears once decoded', '/.%2F%2Fevil.example'],
    ['a parent segment to the login page once decoded', '/a/..%2Flogin'],
    ['input that encoding makes longer than the limit', `/a${' '.repeat(1000)}b`],
    ['very long input', `/${'a'.repeat(5000)}`],
    ['one character over the length limit', `/${'a'.repeat(2048)}`],
    ['the login page', '/login'],
    ['the login page with a query', '/login?redirect=/dashboard'],
    ['the login page, trailing slash', '/login/'],
    ['the login page, several trailing slashes', '/login//'],
    ['the API root, several trailing slashes', '/api//'],
    ['the login page, other case', '/LOGIN'],
    ['the login page via dot segments', '/a/../login'],
    ['the API root', '/api'],
    ['an API route', '/api/me/posts'],
    ['an auth API route', '/api/auth/sign-out'],
    ['an API route, other case', '/API/me/posts'],
    ['an API route, encoded slash', '/api%2Fme'],
  ]
  it.each(rejected)('rejects %s', (_, value) => {
    expect(safeRedirect(value)).toBe(DEFAULT)
  })

  const accepted: Array<[string, string, string]> = [
    ['root', '/', '/'],
    ['a page', '/about', '/about'],
    ['the dashboard', '/dashboard', '/dashboard'],
    ['query and hash', '/about?tab=1#top', '/about?tab=1#top'],
    ['a hash that looks like a host', '/about#//evil.example', '/about#//evil.example'],
    ['a path that starts with api', '/apiary', '/apiary'],
    ['a path that starts with login', '/login-help', '/login-help'],
    ['dot segments that stay local', '/a/./b/../about', '/a/about'],
    ['exactly the length limit', `/${'a'.repeat(2047)}`, `/${'a'.repeat(2047)}`],
  ]
  it.each(accepted)('keeps %s', (_, value, expected) => {
    expect(safeRedirect(value)).toBe(expected)
  })
})

const ORIGIN = 'http://app.invalid'

// The `javascript:` scheme, assembled so that no script URL literal sits in the source (eslint/no-script-url).
const SCRIPT_SCHEME = ['java', 'script:'].join('')

/** Paths assembled from the pieces that make open redirects: slashes, dots, encodings, hosts and schemes. */
const hostile = fc
  .array(
    fc.oneof(
      fc.constantFrom('/', '//', '\\', '.', '..', '%2e', '%2E', '%2f', '%2F', '%5c', '%5C', '%25', '%252f', '%252F'),
      fc.constantFrom('evil.example', '@', ':', 'https:', SCRIPT_SCHEME, '?', '#', '\t', '\n', ' ', '%09', '%0a'),
      fc.constantFrom('login', 'LOGIN', 'api', 'Api', 'dashboard', 'about'),
      fc.string({ maxLength: 3 }),
    ),
    { maxLength: 12 },
  )
  .map((parts) => `/${parts.join('')}`)
const inputs = fc.oneof(hostile, fc.string(), fc.webPath(), fc.webUrl())

/** Paths just under the length limit with characters that parsing percent-encodes, which makes them longer. */
const nearTheLimit = fc
  .string({ unit: fc.constantFrom('a', 'b', ' ', '"', '<', '>', '`', '{', '}'), minLength: 1990, maxLength: 2047 })
  .map((text) => `/a${text}`.slice(0, 2048))

const decodeOnce = (text: string) => {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

describe('safeRedirect properties', () => {
  it('returns a same-origin path, even after one more decode', () => {
    fc.assert(
      fc.property(inputs, (input) => {
        const target = safeRedirect(input)
        expect(target.startsWith('/') && !target.startsWith('//'), target).toBe(true)
        const url = new URL(target, ORIGIN)
        expect(url.origin).toBe(ORIGIN)
        expect(url.pathname.startsWith('//'), target).toBe(false)
        // Something downstream that decodes the path once more must still land on this site.
        const decoded = new URL(decodeOnce(url.pathname), ORIGIN)
        expect(decoded.origin, target).toBe(ORIGIN)
        expect(decoded.pathname.startsWith('//'), target).toBe(false)
      }),
      { numRuns: 2000 },
    )
  })

  it('never returns the login page or the API', () => {
    fc.assert(
      fc.property(inputs, (input) => {
        const route = decodeOnce(new URL(safeRedirect(input), ORIGIN).pathname)
          .toLowerCase()
          .replace(/\/+$/, '')
        expect(route === '/login' || route === '/api' || route.startsWith('/api/'), route).toBe(false)
      }),
      { numRuns: 2000 },
    )
  })

  it('is idempotent: a returned path is accepted as it is', () => {
    fc.assert(
      fc.property(fc.oneof(inputs, nearTheLimit), (input) => {
        const target = safeRedirect(input)
        expect(safeRedirect(target)).toBe(target)
      }),
      { numRuns: 2000 },
    )
  })
})
