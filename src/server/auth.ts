import '@tanstack/react-start/server-only'
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { betterAuth } from 'better-auth'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { db } from './db/client.ts'
import * as schema from './db/schema/index.ts'
import { env } from './env.ts'
import { log } from './log.ts'

export const auth = betterAuth({
  appName: 'ProofStack',
  baseURL: env.appUrl,
  secret: env.authSecret,
  database: drizzleAdapter(db, { provider: 'pg', schema }),
  emailAndPassword: { enabled: true, autoSignIn: false, minPasswordLength: 12, maxPasswordLength: 128 },
  // Public sign-up is closed over HTTP. Accounts are created with `pnpm user:create`,
  // which calls the server API directly (disabledPaths only affects the HTTP router).
  // The HTTP router is further restricted to an allowlist in ./http/auth-handler.ts.
  disabledPaths: ['/sign-up/email'],
  // Built-in rules still apply on top of this default: /sign-in/* allows 3 requests per 10 s per IP.
  // Counters live in the rateLimit table, so every instance shares them; Better Auth increments them with
  // one conditional UPDATE, which is atomic under concurrent requests. /get-session is a read that every
  // page guard makes, so it is not counted.
  rateLimit: {
    enabled: env.isProduction,
    window: 60,
    max: 100,
    storage: 'database',
    customRules: { '/get-session': false },
  },
  advanced: {
    // Every request reaches Better Auth with the TCP peer as the last X-Forwarded-For hop
    // (./http/forwarded-for.ts). Hops inside TRUSTED_PROXIES are skipped from the right; the first address
    // outside them is the client. With no trusted proxies the header holds only the peer.
    ipAddress: { ipAddressHeaders: ['x-forwarded-for'], trustedProxies: env.trustedProxies },
  },
  // Unexpected errors (e.g. database down) are thrown to src/server/http/auth-handler.ts, which logs
  // them as JSON without query parameters and answers an empty 500. Auth failures still answer normally.
  onAPIError: { throw: true },
  logger: {
    level: env.isProduction ? 'warn' : 'info',
    log: (level, message, ...args) =>
      log(level, message, { source: 'better-auth', ...(args.length ? { error: args[0] } : {}) }),
  },
  // Must stay last: forwards Set-Cookie through TanStack Start.
  plugins: [tanstackStartCookies()],
})
