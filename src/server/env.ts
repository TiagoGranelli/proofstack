import '@tanstack/react-start/server-only'

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
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(`${name} must use http or https`)
  if (url.pathname !== '/' || url.search || url.hash)
    throw new Error(`${name} must be an origin such as https://example.com`)
  return url.origin
}

const readSecret = (name: string): string => {
  const value = read(name)
  if (value.length < 32)
    throw new Error(`${name} must have at least 32 characters (generate with: openssl rand -base64 32)`)
  return value
}

const readHeaderName = (name: string): string | undefined => {
  const value = process.env[name]?.trim().toLowerCase()
  if (!value) return undefined
  if (!/^[a-z0-9-]+$/.test(value)) throw new Error(`${name} must be a single HTTP header name such as x-forwarded-for`)
  return value
}

const readInt = (name: string, fallback: number, min: number, max: number): number => {
  const raw = process.env[name]?.trim()
  if (!raw) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`${name} must be an integer between ${min} and ${max}`)
  return value
}

const readDatabaseUrl = (name: string): string => {
  const value = read(name)
  if (!/^postgres(ql)?:\/\//.test(value)) throw new Error(`${name} must be a postgres:// connection string`)
  return value
}

export const env = {
  databaseUrl: readDatabaseUrl('DATABASE_URL'),
  /** Maximum connections per process. Keep instances × this below Postgres `max_connections`. */
  databasePoolMax: readInt('DATABASE_POOL_MAX', 10, 1, 100),
  /** Public origin of the app, e.g. https://app.example.com. Used for auth cookies, CSRF and SSR API calls. */
  appUrl: readOrigin('APP_URL'),
  authSecret: readSecret('BETTER_AUTH_SECRET'),
  /**
   * Header carrying the client IP, set by a trusted reverse proxy (e.g. x-real-ip or x-forwarded-for).
   * Unset = no proxy: the TCP peer address is the client IP and forwarding headers are ignored.
   */
  trustedIpHeader: readHeaderName('TRUSTED_IP_HEADER'),
  isProduction: process.env.NODE_ENV === 'production',
}
