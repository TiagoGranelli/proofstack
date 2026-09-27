// How the account page lists a recorded client address (src/server/http/client-address.ts). Better Auth keeps
// only the /64 network of an IPv6 client, zero-filled and uncompressed. Pure function: no app.
import { describe, expect, it } from 'vitest'
import { displayClientAddress } from '#/server/http/client-address.ts'

describe('displayClientAddress', () => {
  it('keeps an IPv4 address whole', () => {
    expect(displayClientAddress('203.0.113.9')).toBe('203.0.113.9')
  })

  it('shows an IPv6 address as the /64 network Better Auth recorded', () => {
    expect(displayClientAddress('2001:0db8:0001:0002:0000:0000:0000:0000')).toBe('2001:db8:1:2::/64')
    // ::1 is recorded as its network, all zeros.
    expect(displayClientAddress('0000:0000:0000:0000:0000:0000:0000:0000')).toBe('::/64')
  })
})
