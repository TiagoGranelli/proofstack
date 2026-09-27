const LOCALE = 'en'
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY

/** Up to which age a time reads relative ("5 minutes ago"), and in which unit. Older reads as a date. */
const RELATIVE_UNITS: ReadonlyArray<{ below: number; unit: Intl.RelativeTimeFormatUnit; size: number }> = [
  { below: HOUR, unit: 'minute', size: MINUTE },
  { below: DAY, unit: 'hour', size: HOUR },
  { below: WEEK, unit: 'day', size: DAY },
]

/** The browser's clock and time zone; `timeZone` defaults to the runtime's. */
export type Clock = { readonly now: number; readonly timeZone?: string }

const relative = (elapsed: number): string | undefined => {
  if (elapsed < MINUTE) return 'just now'
  const scale = RELATIVE_UNITS.find(({ below }) => elapsed < below)
  if (!scale) return undefined
  const format = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' })
  return format.format(-Math.floor(elapsed / scale.size), scale.unit)
}

/**
 * How a post's time reads: `label` on the page, `title` (the full date and time) on hover. With a `clock` it is
 * local and relative when recent ("just now", "5 minutes ago", "yesterday", then "Sep 20, 2026"). Without one,
 * during SSR and hydration, it is the date in UTC, which the server and every browser render alike, so hydration
 * never mismatches; the browser switches to its clock right after (PostTime). A time ahead of the clock (a clock
 * running behind the server's) reads "just now".
 *
 * @example describePostTime('2026-09-27T12:00:00.000Z', { now: Date.parse('2026-09-27T12:05:00Z') }).label // '5 minutes ago'
 */
export function describePostTime(iso: string, clock: Clock | null): { label: string; title: string } {
  const time = new Date(iso)
  const timeZone = clock ? clock.timeZone : 'UTC'
  const date = new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium', timeZone })
  const full = new Intl.DateTimeFormat(LOCALE, { dateStyle: 'full', timeStyle: 'short', timeZone })
  if (!clock) return { label: date.format(time), title: `${full.format(time)} UTC` }
  return { label: relative(clock.now - time.getTime()) ?? date.format(time), title: full.format(time) }
}
