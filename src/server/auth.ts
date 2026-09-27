import '@tanstack/react-start/server-only'
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { betterAuth } from 'better-auth'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { db } from './db/client.ts'
import * as schema from './db/schema/index.ts'
import { env } from './env.ts'
import { CLIENT_IP_HEADER } from './http/client-ip.ts'
import { log } from './log.ts'

export const auth = betterAuth({
  appName: 'ProofStack',
  baseURL: env.appUrl,
  secret: env.authSecret,
  trustedOrigins: [env.appUrl],
  database: drizzleAdapter(db, { provider: 'pg', schema }),
  emailAndPassword: { enabled: true, autoSignIn: false, minPasswordLength: 12, maxPasswordLength: 128 },
  // Public sign-up is closed over HTTP. Accounts are created with `pnpm user:create`,
  // which calls the server API directly (disabledPaths only affects the HTTP router).
  // The HTTP router is further restricted to an allowlist in ./http/auth-handler.ts.
  disabledPaths: ['/sign-up/email'],
  // Built-in rules still apply on top of this default: /sign-in/* allows 3 requests per 10 s per IP.
  // The memory store is per process; see docs/operations.md before running several instances.
  rateLimit: { enabled: env.isProduction, window: 60, max: 100, storage: 'memory' },
  advanced: {
    // Only this header is read, and only the auth route sets it (from the TCP peer or TRUSTED_IP_HEADER).
    // Without it Better Auth would trust a client-sent X-Forwarded-For, or fall back to one shared bucket.
    ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
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
