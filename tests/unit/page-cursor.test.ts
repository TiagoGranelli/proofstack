import { Exit, Schema } from 'effect'
// The list cursor (`PageCursor` in src/contract/posts.ts): an opaque base64url JSON key that the server hands
// out as `nextCursor` and takes back as `?cursor=`. Whatever it decodes to reaches Postgres as
// `::timestamptz` and `::uuid` (src/server/posts/repo.ts), where a malformed value fails the query (a 500)
// instead of answering 400, so the schema must admit exactly the keys Postgres produces and nothing else.
import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { PageCursor } from '#/contract/posts.ts'

type Key = PageCursor

const decode = Schema.decodeUnknownExit(PageCursor)
const withTime = (key: Key, createdAt: string): Key => ({ createdAt, id: key.id })
const withId = (key: Key, id: string): Key => ({ createdAt: key.createdAt, id })
const encode = Schema.encodeSync(PageCursor)
/** Encodes any JSON value the way the server encodes a key, so the tests can send keys it would never make. */
const wire = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
const ID = '00000000-0000-4000-8000-000000000000'
const accepts = (createdAt: string, id = ID) => Exit.isSuccess(decode(wire({ createdAt, id })))

/**
 * An independent statement of a valid key: Postgres's `to_char(... 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')` of a real
 * instant between years 1 and 9999, and a UUID. Written without the schema's pattern so the two can disagree.
 */
const isValidKey = (key: Key) => {
  const shape = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(key.createdAt)
  const millis = new Date(`${key.createdAt.slice(0, 23)}Z`)
  const real = !Number.isNaN(millis.getTime()) && millis.toISOString().slice(0, 23) === key.createdAt.slice(0, 23)
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key.id)
  return shape && real && key.createdAt.slice(0, 4) !== '0000' && uuid
}

/** Keys as Postgres writes them: any instant from year 1 to 9999 at microsecond precision, and a UUID. */
const keys = fc
  .record({
    at: fc.date({
      min: new Date('0001-01-01T00:00:00.000Z'),
      max: new Date('9999-12-31T23:59:59.999Z'),
      noInvalidDate: true,
    }),
    micros: fc.integer({ min: 0, max: 999 }),
    id: fc.uuid(),
  })
  .map(({ at, micros, id }): Key => ({
    createdAt: `${at.toISOString().slice(0, 23)}${String(micros).padStart(3, '0')}Z`,
    id,
  }))

describe('PageCursor', () => {
  it('decodes every key it encodes back to the same key', () => {
    fc.assert(
      fc.property(keys, (key) => {
        const decoded = decode(encode(key))
        expect(Exit.isSuccess(decoded) && decoded.value).toEqual(key)
      }),
    )
  })

  it('never throws on arbitrary input, and admits only valid keys', () => {
    const inputs = fc.oneof(
      // Anything at all, as `?cursor=` can carry.
      fc.string(),
      fc.string({ unit: 'binary' }),
      // Well-formed base64url of arbitrary JSON, and of key-shaped objects with arbitrary strings.
      fc.jsonValue().map((value) => wire(value)),
      fc.record({ createdAt: fc.string(), id: fc.oneof(fc.string(), fc.uuid()) }).map((value) => wire(value)),
      // Near misses: a valid key with its timestamp or id cut or extended.
      fc
        .tuple(keys, fc.nat(40), fc.string())
        .map(([key, cut, extra]) => wire(withTime(key, key.createdAt.slice(0, cut) + extra))),
    )
    fc.assert(
      fc.property(inputs, (input) => {
        const decoded = decode(input)
        // A rejection is always fine; an admitted key must be valid and survive a round trip.
        const key = Exit.isSuccess(decoded) ? decoded.value : undefined
        expect(key === undefined || isValidKey(key), JSON.stringify(key)).toBe(true)
        expect(key === undefined ? decoded : decode(encode(key))).toEqual(decoded)
      }),
      { numRuns: 1000 },
    )
  })

  it('rejects a valid key with anything tampered: suffix, prefix, precision, field ranges or id', () => {
    const tampered = fc.oneof(
      fc.tuple(keys, fc.string({ minLength: 1 })).map(([key, junk]) => withTime(key, key.createdAt + junk)),
      fc.tuple(keys, fc.string({ minLength: 1 })).map(([key, junk]) => withTime(key, junk + key.createdAt)),
      // Five or seven fractional digits.
      keys.map((key) => withTime(key, `${key.createdAt.slice(0, 25)}Z`)),
      keys.map((key) => withTime(key, `${key.createdAt.slice(0, 26)}0Z`)),
      // Month 00 or 13-99, day 00 or 32-99, hour 24-99, minute or second 60-99.
      fc
        .tuple(keys, fc.oneof(fc.constant(0), fc.integer({ min: 13, max: 99 })))
        .map(([key, month]) =>
          withTime(key, `${key.createdAt.slice(0, 5)}${String(month).padStart(2, '0')}${key.createdAt.slice(7)}`),
        ),
      fc
        .tuple(keys, fc.oneof(fc.constant(0), fc.integer({ min: 32, max: 99 })))
        .map(([key, day]) =>
          withTime(key, `${key.createdAt.slice(0, 8)}${String(day).padStart(2, '0')}${key.createdAt.slice(10)}`),
        ),
      fc
        .tuple(keys, fc.integer({ min: 24, max: 99 }))
        .map(([key, hour]) => withTime(key, `${key.createdAt.slice(0, 11)}${hour}${key.createdAt.slice(13)}`)),
      fc
        .tuple(keys, fc.integer({ min: 60, max: 99 }), fc.boolean())
        .map(([key, value, minute]) =>
          withTime(
            key,
            minute
              ? `${key.createdAt.slice(0, 14)}${value}${key.createdAt.slice(16)}`
              : `${key.createdAt.slice(0, 17)}${value}${key.createdAt.slice(19)}`,
          ),
        ),
      // An id with a character that is not hex, or one character more or less.
      fc
        .tuple(keys, fc.nat(35), fc.constantFrom('g', 'z', ' ', '-', '{'))
        .filter(([key, at]) => key.id[at] !== '-')
        .map(([key, at, char]) => withId(key, key.id.slice(0, at) + char + key.id.slice(at + 1))),
      fc.tuple(keys, fc.constantFrom('0', 'a')).map(([key, char]) => withId(key, key.id + char)),
      keys.map((key) => withId(key, key.id.slice(1))),
    )
    fc.assert(
      fc.property(tampered, (key) => {
        expect(Exit.isFailure(decode(wire(key))), JSON.stringify(key)).toBe(true)
      }),
      { numRuns: 1000 },
    )
  })

  it.each([
    ['trailing text after Z', '2026-01-01T00:00:01.000000Zjunk'],
    ['a trailing newline', '2026-01-01T00:00:01.000000Z\n'],
    ['a UTC offset instead of Z', '2026-01-01T00:00:01.000000+00:00'],
    ['year 0', '0000-01-01T00:00:00.000000Z'],
    ['month 13', '2026-13-01T00:00:00.000000Z'],
    ['November 31', '2026-11-31T00:00:00.000000Z'],
    ['February 29 in a common year', '2026-02-29T00:00:00.000000Z'],
    ['hour 24', '2026-01-01T24:00:00.000000Z'],
  ])('rejects %s', (_, createdAt) => {
    expect(accepts(createdAt)).toBe(false)
  })

  it.each([
    ['October', '2026-10-31T23:59:59.999999Z'],
    ['November', '2026-11-30T12:00:00.000001Z'],
    ['December', '2026-12-31T00:00:00.000000Z'],
    ['February 29 in a leap year', '2028-02-29T00:00:00.000000Z'],
    ['year 1', '0001-01-01T00:00:00.000000Z'],
    ['year 9999', '9999-12-31T23:59:59.999999Z'],
  ])('accepts %s', (_, createdAt) => {
    expect(accepts(createdAt)).toBe(true)
  })
})
