import '@tanstack/react-start/server-only'
import { isIPv6 } from 'node:net'

/**
 * Prefix length Better Auth keeps of an IPv6 client address (`advanced.ipAddress.ipv6Subnet` in ../auth.ts),
 * for the rate-limit key and the address stored on the session. 64 is the usual allocation to one subscriber,
 * who can use any address inside it; limiting per full address would give each client unlimited buckets.
 */
export const IPV6_SUBNET = 64

/**
 * A recorded client address as the account page shows it: an IPv4 address as it is, an IPv6 one as the network
 * Better Auth kept, in CIDR notation (`2001:0db8:0001:0002:0000:0000:0000:0000` becomes `2001:db8:1:2::/64`,
 * loopback `::/64`), because the rest of the address was never stored.
 */
export const displayClientAddress = (recorded: string): string =>
  isIPv6(recorded) ? `${new URL(`http://[${recorded}]`).hostname.slice(1, -1)}/${IPV6_SUBNET}` : recorded
