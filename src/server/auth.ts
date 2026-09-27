import '@tanstack/react-start/server-only'
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { betterAuth } from 'better-auth'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '#/contract/limits.ts'
import { postgresRateLimitStorage } from './auth-rate-limit.ts'
import { runInBackground } from './background-tasks.ts'
import { db } from './db/client.ts'
import * as schema from './db/schema/index.ts'
import { env } from './env.ts'
import { AUTH_BASE_PATH, endpointAllowlist, isExposedEndpoint } from './http/auth-endpoints.ts'
import { log } from './log.ts'
import { authMail } from './mail/auth-mail.ts'

export const auth = betterAuth({
  appName: 'ProofStack',
  baseURL: env.appUrl,
  basePath: AUTH_BASE_PATH,
  secret: env.authSecret,
  database: drizzleAdapter(db, { provider: 'pg', schema }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: PASSWORD_MIN_LENGTH,
    maxPasswordLength: PASSWORD_MAX_LENGTH,
    // No session before the address is verified. `pnpm user:create` marks its accounts verified: the operator
    // vouches for the address. Sign-up then answers the same for new and existing emails (no enumeration),
    // and the owner of an existing one gets a heads-up instead.
    requireEmailVerification: true,
    autoSignIn: false,
    onExistingUserSignUp: authMail.existingAccount,
    sendResetPassword: authMail.resetPassword,
    // A reset proves control of the mailbox, not of the sessions: end them all.
    revokeSessionsOnPasswordReset: true,
  },
  emailVerification: {
    sendVerificationEmail: authMail.verifyEmail,
    sendOnSignUp: true,
    // A sign-in with the right password but an unverified address sends a fresh link.
    sendOnSignIn: true,
    // Following the link verifies the address; signing in stays a separate, rate-limited step.
    autoSignInAfterVerification: false,
  },
  // Deletion needs the password (the UI always sends it); posts go with the user (foreign key cascade).
  user: { deleteUser: { enabled: true } },
  // AUTH_SIGN_UP=closed (the default) keeps public sign-up off: accounts come from `pnpm user:create`, which
  // writes through Better Auth's internal adapter. disabledPaths answers 404 before anything else runs, on top of
  // the endpoint allowlist (./http/auth-endpoints.ts). See docs/decisions/0003-sign-up-policy.md.
  disabledPaths: env.authSignUp === 'open' ? [] : ['/sign-up/email'],
  // Built-in rules still apply on top of this default: /sign-in/* allows 3 requests per 10 s per IP.
  // Counters live in the rate_limit table, so every instance shares them. `storage: 'database'` declares that
  // table; the counting itself is ./auth-rate-limit.ts, one atomic upsert per request, because Better Auth's own
  // database storage lets concurrent requests past the limit on Postgres. /get-session is a read that every page
  // guard makes, so it is not counted. Neither are requests the endpoint allowlist answers with 404 (Better Auth
  // counts before plugins run), so invented paths cannot fill the table.
  rateLimit: {
    enabled: env.isProduction,
    window: 60,
    max: 100,
    storage: 'database',
    customStorage: postgresRateLimitStorage,
    customRules: { '/get-session': false, '/**': (request, rule) => (isExposedEndpoint(request) ? rule : false) },
  },
  advanced: {
    // Better Auth's own deferred work and the mail senders (./mail/auth-mail.ts) run after the response;
    // shutdown waits for them.
    backgroundTasks: { handler: runInBackground },
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
  plugins: [endpointAllowlist(), tanstackStartCookies()],
})
