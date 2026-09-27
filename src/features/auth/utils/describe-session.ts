const BROWSERS: ReadonlyArray<[RegExp, string]> = [
  [/\bEdg(?:e|A|iOS)?\//, 'Edge'],
  [/\b(?:OPR|Opera)\//, 'Opera'],
  [/\b(?:Firefox|FxiOS)\//, 'Firefox'],
  [/\b(?:Chrome|CriOS|Chromium)\//, 'Chrome'],
  [/\bSafari\//, 'Safari'],
]
const SYSTEMS: ReadonlyArray<[RegExp, string]> = [
  [/\b(?:iPhone|iPad|iPod)\b/, 'iOS'],
  [/\bAndroid\b/, 'Android'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bWindows\b/, 'Windows'],
  [/\bMac OS X\b|\bMacintosh\b/, 'macOS'],
  [/\bLinux\b/, 'Linux'],
]

const first = (list: ReadonlyArray<[RegExp, string]>, text: string) => list.find(([pattern]) => pattern.test(text))?.[1]

/** "Firefox on Linux" from a User-Agent header, or a generic label when it is missing or unknown. */
export function describeDevice(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device'
  const browser = first(BROWSERS, userAgent)
  const system = first(SYSTEMS, userAgent)
  if (browser && system) return `${browser} on ${system}`
  return browser ?? system ?? 'Unknown device'
}

/**
 * An ISO timestamp as "2026-09-27 14:05 UTC". Fixed format and zone, so the server-rendered text and the
 * hydrated text are identical whatever the visitor's locale.
 */
export function formatTimestamp(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}
