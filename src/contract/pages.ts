import { Schema, SchemaTransformation } from 'effect'
import { POSTS_PAGE_DEFAULT, POSTS_PAGE_MAX } from './limits.ts'

// Microsecond UTC timestamp as Postgres stores it (a row's `createdAt` on the wire is rounded to milliseconds,
// which is not precise enough to resume a keyset scan without skipping or repeating rows).
const CURSOR_TIME = /^(?!0000)\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{6}Z$/
/**
 * Rejects well-formed but impossible dates such as February 30 (the pattern already rules out year 0), so
 * they never reach Postgres, which would fail the query instead of answering 400.
 */
const isCalendarDate = Schema.makeFilter<string>(
  (value) => {
    const date = new Date(`${value.slice(0, 23)}Z`)
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 23) === value.slice(0, 23)
  },
  { expected: 'a valid calendar date' },
)

/**
 * Where the next page starts: the (createdAt, id) key of the last row of the previous page. Lists are
 * ordered by that pair, newest first, so a page is "every row with a smaller key", and rows added
 * while a client pages through never shift the pages it has not fetched yet. On the wire it is an opaque
 * base64url string; anything that does not decode to a valid key is a 400.
 */
export const PageCursor = Schema.String.annotate({
  identifier: 'PageCursor',
  description: 'Opaque cursor from `nextCursor` of the previous page. Omit it for the first page.',
}).pipe(
  Schema.decodeTo(Schema.String, SchemaTransformation.stringFromBase64UrlString),
  Schema.decodeTo(
    Schema.fromJsonString(
      Schema.Struct({
        createdAt: Schema.String.check(Schema.isPattern(CURSOR_TIME), isCalendarDate),
        id: Schema.String.check(Schema.isUUID()),
      }),
    ),
  ),
)
export type PageCursor = typeof PageCursor.Type

// Query parameters arrive as strings. The pattern keeps "1e1" or " 5" out; the range is checked on the number.
// Effect exports a pattern to the OpenAPI document only when the RegExp has the `u` flag.
const PageLimit = Schema.String.check(Schema.isPattern(/^\d{1,3}$/u, { expected: 'a whole number' }))
  .annotate({ description: `Items per page, 1 to ${POSTS_PAGE_MAX}. Default ${POSTS_PAGE_DEFAULT}.` })
  .pipe(
    Schema.decodeTo(
      Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: POSTS_PAGE_MAX })),
      SchemaTransformation.numberFromString,
    ),
  )

/** The query of a list endpoint, `?cursor=&limit=`: `HttpApiEndpoint.get('list', path, { query: PageQuery, ... })`. */
export const PageQuery = { cursor: Schema.optionalKey(PageCursor), limit: Schema.optionalKey(PageLimit) }

/**
 * One page of a list, newest first; `nextCursor` is null on the last page. Give it an identifier and a description:
 * `pageOf(Post).annotate({ identifier: 'PostPage', ... })`.
 */
export const pageOf = <Item extends Schema.Top>(
  itemSchema: Item,
): Schema.Struct<{ readonly items: Schema.$Array<Item>; readonly nextCursor: Schema.NullOr<typeof PageCursor> }> =>
  Schema.Struct({ items: Schema.Array(itemSchema), nextCursor: Schema.NullOr(PageCursor) })
