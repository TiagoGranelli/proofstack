const DEFAULT_AFTER_SIGN_IN = '/dashboard'
const PLACEHOLDER_ORIGIN = 'http://proofstack.invalid'
/** Longer values are not a path this app links to; refusing them keeps the check cheap. */
const MAX_LENGTH = 2048

const decode = (path: string) => {
  try {
    return decodeURIComponent(path)
  } catch {
    return undefined
  }
}

/**
 * Where to go after signing in. Accepts only a same-origin path (so `?redirect=` cannot send a user to
 * another site: no `//host`, `/\host`, `https:` or `javascript:`) and never the login page or the API.
 * The value is checked after URL parsing, because dot segments and percent-encoding can turn a harmless
 * looking path into `//host` (`/.//host`, `/a/..//host`, `/%2e//host`), and again after decoding, in case
 * something downstream decodes it once more (`/%2F/host`, `/%5Chost`). Returns path, search and hash only.
 */
export function safeRedirect(value: unknown): string {
  if (typeof value !== 'string' || value.length > MAX_LENGTH || !value.startsWith('/') || value.includes('\\')) {
    return DEFAULT_AFTER_SIGN_IN
  }
  let url: URL
  try {
    url = new URL(value, PLACEHOLDER_ORIGIN)
  } catch {
    return DEFAULT_AFTER_SIGN_IN
  }
  if (url.origin !== PLACEHOLDER_ORIGIN) return DEFAULT_AFTER_SIGN_IN
  const decoded = decode(url.pathname)
  if (decoded === undefined) return DEFAULT_AFTER_SIGN_IN
  for (const path of [url.pathname, decoded]) {
    if (path.startsWith('//') || path.includes('\\')) return DEFAULT_AFTER_SIGN_IN
  }
  // Route matching is case-insensitive and ignores a trailing slash.
  const route = decoded.toLowerCase().replace(/\/+$/, '')
  if (route === '/login' || route === '/api' || route.startsWith('/api/')) return DEFAULT_AFTER_SIGN_IN
  return url.pathname + url.search + url.hash
}
