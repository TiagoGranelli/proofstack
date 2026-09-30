// describeTime: how a time reads, relative and local in the browser, and the same UTC date on the server and during
// hydration.
import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { describeTime } from '#/components/time/describe-time.ts'

const written = '2026-09-27T12:00:00.000Z'
const after = (milliseconds: number) => ({ now: Date.parse(written) + milliseconds, timeZone: 'UTC' })
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

describe('describeTime', () => {
  it.each<[string, number, string]>([
    ['moments after', 20_000, 'just now'],
    ['a minute after', MINUTE, '1 minute ago'],
    ['five minutes after', 5 * MINUTE + 30_000, '5 minutes ago'],
    ['an hour after', HOUR, '1 hour ago'],
    ['23 hours after', 23 * HOUR + 59 * MINUTE, '23 hours ago'],
    ['a day after', DAY + HOUR, 'yesterday'],
    ['six days after', 6 * DAY, '6 days ago'],
    ['a week after', 7 * DAY, 'Sep 27, 2026'],
    // A browser clock behind the server's: never "in 2 minutes".
    ['before it, by a clock running late', -2 * MINUTE, 'just now'],
  ])('reads %s as "%s"', (_, elapsed, label) => {
    expect(describeTime(written, after(elapsed)).label).toBe(label)
  })

  it('reads older times as a date in the browser time zone, with the full local time on hover', () => {
    const inSaoPaulo = { now: Date.parse('2026-10-20T00:00:00Z'), timeZone: 'America/Sao_Paulo' }
    // 01:30 UTC on the 1st is still the evening of September 30 in São Paulo (UTC-3).
    expect(describeTime('2026-10-01T01:30:00.000Z', inSaoPaulo)).toEqual({
      label: 'Sep 30, 2026',
      title: 'Wednesday, September 30, 2026 at 10:30 PM',
    })
  })

  it('without a clock (SSR, hydration) reads the UTC date, whatever the time zone of the machine', () => {
    expect(describeTime('2026-10-01T01:30:00.000Z', null)).toEqual({
      label: 'Oct 1, 2026',
      title: 'Thursday, October 1, 2026 at 1:30 AM UTC',
    })
  })

  it('never throws, and without a clock depends on nothing but the time', () => {
    const times = fc.date({ min: new Date('1970-01-01'), max: new Date('2200-01-01'), noInvalidDate: true })
    fc.assert(
      fc.property(times, fc.integer({ min: -DAY, max: 400 * DAY }), (time, elapsed) => {
        const iso = time.toISOString()
        expect(describeTime(iso, { now: time.getTime() + elapsed }).label).not.toBe('')
        expect(describeTime(iso, null)).toEqual(describeTime(iso, null))
      }),
    )
  })
})
