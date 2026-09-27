import '@tanstack/react-start/server-only'

/**
 * The X-Forwarded-For value Better Auth resolves the client IP from (`advanced.ipAddress` in ../auth.ts). The
 * TCP peer is always the last hop, so a client cannot hide behind a value it wrote itself:
 * - With trusted proxies, the chain received from the peer stays in front of it. Better Auth walks the chain
 *   from the right, skips hops inside TRUSTED_PROXIES and takes the first address outside them. A client that
 *   connects directly is itself that first address, whatever it sent.
 * - Without trusted proxies, the peer is the only value: nothing a client sends is believed, and Better Auth
 *   accepts a forwarded header only when it holds a single address.
 * Without a peer (no socket) there is nothing to vouch for, and the header is dropped (`undefined`).
 */
export const forwardedFor = (
  received: string | null,
  peer: string | undefined,
  trustsProxies: boolean,
): string | undefined => {
  if (!peer) return undefined
  const chain = trustsProxies ? received?.trim() : undefined
  return chain ? `${chain}, ${peer}` : peer
}
