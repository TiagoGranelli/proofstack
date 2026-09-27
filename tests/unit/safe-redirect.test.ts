// safeRedirect decides where `?redirect=` may send a user after sign-in. Pure function: no app needed.
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
    ['very long input', `/${'a'.repeat(5000)}`],
    ['the login page', '/login'],
    ['the login page with a query', '/login?redirect=/dashboard'],
    ['the login page, trailing slash', '/login/'],
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
  ]
  it.each(accepted)('keeps %s', (_, value, expected) => {
    expect(safeRedirect(value)).toBe(expected)
  })
})
