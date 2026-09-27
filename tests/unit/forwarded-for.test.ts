// forwardedFor builds the only X-Forwarded-For value Better Auth reads the client IP from. Pure function: no app.
import { describe, expect, it } from 'vitest'
import { forwardedFor } from '#/server/http/forwarded-for.ts'

describe('forwardedFor', () => {
  describe('without trusted proxies', () => {
    it('is the TCP peer alone, whatever the client sent', () => {
      expect(forwardedFor(null, '198.51.100.7', false)).toBe('198.51.100.7')
      expect(forwardedFor('203.0.113.9', '198.51.100.7', false)).toBe('198.51.100.7')
      expect(forwardedFor('203.0.113.9, 10.0.0.1', '::ffff:127.0.0.1', false)).toBe('::ffff:127.0.0.1')
    })
  })

  describe('with trusted proxies', () => {
    it('appends the TCP peer as the last hop of the received chain', () => {
      expect(forwardedFor('203.0.113.9', '10.0.0.2', true)).toBe('203.0.113.9, 10.0.0.2')
      expect(forwardedFor(' 203.0.113.9, 10.0.0.1 ', '10.0.0.2', true)).toBe('203.0.113.9, 10.0.0.1, 10.0.0.2')
    })

    it('is the TCP peer alone when nothing was received', () => {
      expect(forwardedFor(null, '10.0.0.2', true)).toBe('10.0.0.2')
      expect(forwardedFor('  ', '10.0.0.2', true)).toBe('10.0.0.2')
    })
  })

  it('drops the header when there is no peer to vouch for it', () => {
    expect(forwardedFor('203.0.113.9', undefined, true)).toBeUndefined()
    expect(forwardedFor(null, '', false)).toBeUndefined()
  })
})
