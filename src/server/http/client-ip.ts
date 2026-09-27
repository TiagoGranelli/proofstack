import '@tanstack/react-start/server-only'
import { BlockList, isIP } from 'node:net'
import { getRequestIP } from '@tanstack/react-start/server'
import { env } from '../env.ts'
import { log } from '../log.ts'

/**
 * The only header Better Auth reads the client IP from (see auth.ts). The auth route sets it from
 * `resolveClientIp` and drops any copy sent by the client, so X-Forwarded-For spoofing cannot
 * reset or share rate-limit buckets.
 */
export const CLIENT_IP_HEADER = 'x-proofstack-client-ip'

const unmapIPv4 = (ip: string) => (ip.startsWith('::ffff:') && isIP(ip.slice(7)) === 4 ? ip.slice(7) : ip)

/** Loopback, RFC 1918, IPv6 unique-local and link-local: where a reverse proxy in front of the app connects from. */
const proxyNetworks = new BlockList()
proxyNetworks.addSubnet('127.0.0.0', 8, 'ipv4')
proxyNetworks.addSubnet('10.0.0.0', 8, 'ipv4')
proxyNetworks.addSubnet('172.16.0.0', 12, 'ipv4')
proxyNetworks.addSubnet('192.168.0.0', 16, 'ipv4')
proxyNetworks.addAddress('::1', 'ipv6')
proxyNetworks.addSubnet('fc00::', 7, 'ipv6')
proxyNetworks.addSubnet('fe80::', 10, 'ipv6')

const isPrivate = (ip: string) => {
  const family = isIP(ip)
  return family !== 0 && proxyNetworks.check(ip, family === 4 ? 'ipv4' : 'ipv6')
}

let warnedAboutProxy = false
let warnedAboutPublicPeer = false

/**
 * Client IP for rate limiting and session metadata.
 * - TRUSTED_IP_HEADER set and the TCP peer is a private or loopback address (a reverse proxy on the
 *   same host or network): the last value of that header, if it is an IP.
 * - Otherwise, or if the header is missing/invalid: the TCP peer address. A client that connects
 *   directly can therefore never pick its own rate-limit bucket.
 */
export const resolveClientIp = (request: Request): string | undefined => {
  const raw = getRequestIP()
  const peer = raw ? unmapIPv4(raw) : undefined
  if (env.trustedIpHeader && request.headers.has(env.trustedIpHeader)) {
    if (peer && isPrivate(peer)) {
      const last = request.headers.get(env.trustedIpHeader)?.split(',').at(-1)?.trim()
      if (last && isIP(unmapIPv4(last))) return unmapIPv4(last)
    } else if (!warnedAboutPublicPeer) {
      warnedAboutPublicPeer = true
      log('warn', 'ignoring TRUSTED_IP_HEADER from a public address', {
        peer,
        header: env.trustedIpHeader,
        hint: 'the header is trusted only from loopback and private addresses (a local reverse proxy); see docs/operations.md',
      })
    }
  }
  if (!peer) return undefined
  if (!env.trustedIpHeader && !warnedAboutProxy && request.headers.has('x-forwarded-for') && isPrivate(peer)) {
    warnedAboutProxy = true
    log('warn', 'request has X-Forwarded-For from a private address but TRUSTED_IP_HEADER is unset', {
      peer,
      hint: 'behind a reverse proxy every client shares the proxy IP and therefore one sign-in rate-limit bucket; see docs/operations.md',
    })
  }
  return peer
}
