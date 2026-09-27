const DEFAULT_AFTER_SIGN_IN = '/dashboard'
const PLACEHOLDER_ORIGIN = 'http://proofstack.invalid'
/** Longer values are not a path this app links to; refusing them keeps the check cheap. */
const MAX_LENGTH = 2048

/** `path` resolved on this site, or undefined when it names another origin or does not parse. */
const parse = (path: string) => {
  try {
    const url = new URL(path, PLACEHOLDER_ORIGIN)
    return url.origin === PLACEHOLDER_ORIGIN ? url : undefined
  } catch {
    return undefined
  }
}

const decode = (path: string) => {
  try {
    return decodeURIComponent(path)
  } catch {
    return undefined
  }
}

const isLoginOrApi = (path: string) => {
  // Route matching is case-insensitive and ignores a trailing slash.
  const route = path.toLowerCase().replace(/\/+$/, '')
  return route === '/login' || route === '/api' || route.startsWith('/api/')
}

/**
 * Where to go after signing in. Accepts only a same-origin path (so `?redirect=` cannot send a user to
 * another site: no `//host`, `/\host`, `https:` or `javascript:`) and never the login page or the API.
 * The value is checked after URL parsing, because dot segments and percent-encoding can turn a harmless
 * looking path into `//host` (`/.//host`, `/a/..//host`, `/%2e//host`), and again after decoding and parsing
 * once more, in case something downstream decodes it again (`/%2F/host`, `/%5Chost`, `/%09/host`, whose tab a
 * URL parser drops, or `/.%2F%2Fhost`, whose dot segment only appears once decoded). Returns path, search and
 * hash only, never longer than the input limit, so that a returned value is always accepted as it is.
 */
export function safeRedirect(value: unknown): string {
  if (typeof value !== 'string' || value.length > MAX_LENGTH || !value.startsWith('/') || value.includes('\\')) {
    return DEFAULT_AFTER_SIGN_IN
  }
  const url = parse(value)
  const decoded = url && decode(url.pathname)
  const decodedUrl = decoded === undefined ? undefined : parse(decoded)
  if (!url || decoded === undefined || !decodedUrl || decoded.includes('\\')) return DEFAULT_AFTER_SIGN_IN
  for (const path of [url.pathname, decoded, decodedUrl.pathname]) {
    if (path.startsWith('//') || isLoginOrApi(path)) return DEFAULT_AFTER_SIGN_IN
  }
  const target = url.pathname + url.search + url.hash
  // Parsing percent-encodes what the input left raw (a space becomes %20), which can make the result longer.
  return target.length > MAX_LENGTH ? DEFAULT_AFTER_SIGN_IN : target
}
