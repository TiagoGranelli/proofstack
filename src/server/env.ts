import '@tanstack/react-start/server-only'
import { isIP } from 'node:net'

// Validated once at startup: src/server/nitro/startup.ts imports this module before the server
// listens, so a bad configuration stops the process with one of these messages.

const read = (name: string): string => {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing required environment variable ${name}. See .env.example.`)
  return value
}

const readOrigin = (name: string): string => {
  const raw = read(name)
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`${name} must be an origin such as https://example.com (got "${raw}")`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    throw new Error(`${name} must use http or https (got "${url.protocol}")`)
  if (url.pathname !== '/' || url.search || url.hash)
    throw new Error(
      `${name} must be an origin such as https://example.com, without a path, query or hash (got "${raw}")`,
    )
  return url.origin
}

const readSecret = (name: string): string => {
  const value = read(name)
  if (value.length < 32)
    throw new Error(
      `${name} must have at least 32 characters (got ${value.length}; generate one with: openssl rand -base64 32)`,
    )
  return value
}

/** IP addresses and CIDR ranges (`10.0.0.0/8`, `::1/128`), comma-separated. Better Auth ignores invalid entries. */
const readCidrList = (name: string): string[] => {
  const entries = (process.env[name] ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  for (const entry of entries) {
    // `split` always returns at least one element.
    const [address, prefix, ...rest] = entry.split('/') as [string, ...string[]]
    const family = isIP(address)
    const bits = family === 4 ? 32 : 128
    const validPrefix = prefix === undefined || (/^\d+$/.test(prefix) && Number(prefix) <= bits)
    if (family === 0 || !validPrefix || rest.length > 0)
      throw new Error(`${name} must list IP addresses or CIDR ranges such as 10.0.0.0/8 (got "${entry}")`)
  }
  return entries
}

/** An optional integer setting: `fallback` when unset, an error outside `min`..`max`. */
const readInt = (name: string, bounds: { fallback: number; min: number; max: number }): number => {
  const { fallback, min, max } = bounds
  const raw = process.env[name]?.trim()
  if (!raw) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`${name} must be an integer between ${min} and ${max} (got "${raw}")`)
  return value
}

/** The scheme of a URL-like value, the only part of a connection string safe to print (the rest may hold a password). */
const schemeOf = (value: string): string => /^([a-z][a-z\d+.-]*):/i.exec(value)?.[1] ?? 'none'

const readDatabaseUrl = (name: string): string => {
  const value = read(name)
  if (!/^postgres(ql)?:\/\//.test(value))
    throw new Error(`${name} must be a postgres:// connection string (got scheme "${schemeOf(value)}")`)
  return value
}

const readChoice = <const T extends string>(name: string, choices: readonly [T, ...T[]]): T => {
  const value = process.env[name]?.trim() || choices[0]
  const choice = choices.find((candidate) => candidate === value)
  if (!choice) throw new Error(`${name} must be one of ${choices.join(', ')} (got "${value}")`)
  return choice
}

/** SMTP_URL and MAIL_FROM, both or neither. Credentials go in the URL (percent-encoded). */
const readSmtp = (): { url: string; from: string } | undefined => {
  const url = process.env.SMTP_URL?.trim()
  if (!url) return undefined
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('SMTP_URL must be a URL such as smtps://user:password@smtp.example.com:465')
  }
  if (!['smtp:', 'smtps:'].includes(parsed.protocol) || !parsed.hostname)
    throw new Error(
      `SMTP_URL must use smtp:// (STARTTLS) or smtps:// (TLS) and name a host (got scheme "${schemeOf(url)}")`,
    )
  const from = read('MAIL_FROM')
  if (!/@[^@\s>]+>?$/.test(from))
    throw new Error(`MAIL_FROM must be an address such as "Acme <no-reply@example.com>" (got "${from}")`)
  return { url, from }
}

// Renamed variables fail loudly instead of being ignored.
if (process.env.TRUSTED_IP_HEADER?.trim())
  throw new Error(
    'TRUSTED_IP_HEADER was replaced by TRUSTED_PROXIES (the addresses of your reverse proxies). See docs/operations.md.',
  )

export const env = {
  databaseUrl: readDatabaseUrl('DATABASE_URL'),
  /** Maximum connections per process. Keep instances × this below Postgres `max_connections`. */
  databasePoolMax: readInt('DATABASE_POOL_MAX', { fallback: 10, min: 1, max: 100 }),
  /**
   * DATABASE_URL points at a connection pooler (PgBouncer, Neon's `-pooler` host, Supabase's pooler). Poolers
   * refuse startup parameters they do not track, so the pool then sends no `statement_timeout` and
   * `idle_in_transaction_session_timeout`; set them on the app's role instead (docs/operations.md, "Connection
   * poolers").
   */
  databaseUrlPooled: readChoice('DATABASE_URL_POOLED', ['false', 'true']) === 'true',
  /** Public origin of the app, e.g. https://app.example.com. Used for auth cookies, CSRF and SSR API calls. */
  appUrl: readOrigin('APP_URL'),
  authSecret: readSecret('BETTER_AUTH_SECRET'),
  /**
   * Reverse proxies whose X-Forwarded-For entries are believed (Better Auth `advanced.ipAddress.trustedProxies`).
   * Empty = no proxy: the TCP peer address is the client IP and forwarded headers are ignored.
   */
  trustedProxies: readCidrList('TRUSTED_PROXIES'),
  /** Outgoing mail. Unset: messages are only logged (./mail/log-mailer.ts), so nobody receives them. */
  smtp: readSmtp(),
  /**
   * Who may create an account. `closed` (default): only `pnpm user:create`. `open`: anyone, through /sign-up,
   * with a verified email address before the first sign-in, so it needs SMTP_URL.
   */
  authSignUp: readChoice('AUTH_SIGN_UP', ['closed', 'open']),
  isProduction: process.env.NODE_ENV === 'production',
}

if (env.authSignUp === 'open' && !env.smtp)
  throw new Error('AUTH_SIGN_UP=open needs SMTP_URL and MAIL_FROM: new accounts must verify their email address')
