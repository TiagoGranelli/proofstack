// How the account page labels a session. Pure functions: no app.
import { describe, expect, it } from 'vitest'
import { describeAddress, describeDevice, formatTimestamp } from '#/features/auth/utils/describe-session.ts'

describe('describeDevice', () => {
  it.each([
    ['Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0', 'Firefox on Linux'],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
      'Edge on Windows',
    ],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
      'Safari on macOS',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1',
      'Chrome on iOS',
    ],
    [
      'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
      'Chrome on Android',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 OPR/115.0.0.0',
      'Opera on Windows',
    ],
    [
      'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      'Chrome on ChromeOS',
    ],
    [
      'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/131.0 Mobile/15E148 Safari/605.1.15',
      'Firefox on iOS',
    ],
    [
      'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 EdgA/130.0.0.0',
      'Edge on Android',
    ],
    // Only one of the two is known: that one alone, never "undefined".
    ['Firefox/131.0', 'Firefox'],
    ['Dalvik/2.1.0 (Linux; U; Android 14; Pixel 7 Build/AP2A.240905.003)', 'Android'],
    ['curl/8.10.1', 'Unknown device'],
    ['', 'Unknown device'],
    [null, 'Unknown device'],
  ])('%s', (userAgent, expected) => {
    expect(describeDevice(userAgent)).toBe(expected)
  })
})

describe('formatTimestamp', () => {
  it('renders UTC to the minute, the same on the server and in any browser', () => {
    expect(formatTimestamp('2026-09-27T14:05:59.999Z')).toBe('2026-09-27 14:05 UTC')
    expect(formatTimestamp('2026-09-27T16:05:00+02:00')).toBe('2026-09-27 14:05 UTC')
  })

  it('leaves an unparseable value as it is', () => {
    expect(formatTimestamp('yesterday')).toBe('yesterday')
  })
})

describe('describeAddress', () => {
  it('shows an IPv4 address as it is and labels an IPv6 network as one', () => {
    expect(describeAddress('203.0.113.9')).toBe('203.0.113.9')
    expect(describeAddress('2001:db8:1:2::/64')).toBe('IPv6 network 2001:db8:1:2::/64')
  })
})
