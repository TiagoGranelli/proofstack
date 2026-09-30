import '@tanstack/react-start/server-only'
import { desc, sql, type SQL } from 'drizzle-orm'
import type { PgColumn } from 'drizzle-orm/pg-core'
import { POSTS_PAGE_DEFAULT } from '#/contract/limits.ts'
import type { PageCursor } from '#/contract/pages.ts'

/** A page of a list ordered by (created_at desc, id desc): the first `limit` rows after the cursor's key. */
export interface PageRequest {
  readonly cursor?: PageCursor | undefined
  readonly limit: number
}

/** A list endpoint's decoded `PageQuery` as a PageRequest, with the default limit when the client names none. */
export const pageRequest = (query: {
  readonly cursor?: PageRequest['cursor']
  readonly limit?: number
}): PageRequest => ({
  cursor: query.cursor,
  limit: query.limit ?? POSTS_PAGE_DEFAULT,
})

/** The pieces of a newest-first keyset query over a table's `created_at` and uuid `id`. */
export interface Keyset {
  /**
   * The sort key at full (microsecond) precision, selected as `cursorAt`. `createdAt` as a JS Date is rounded to
   * milliseconds, and a cursor built from it would skip or repeat rows created within the same millisecond.
   */
  readonly cursorAt: SQL<string>
  /** The WHERE condition of the rows after `cursor`, or none for the first page. */
  readonly after: (cursor: PageCursor | undefined) => SQL | undefined
  /** ORDER BY created_at desc, id desc: the id breaks ties. */
  readonly newestFirst: ReadonlyArray<SQL>
}

/**
 * The keyset of a table with `createdAt` and `id` columns. Its indexes end in (created_at, id), ascending
 * (src/server/db/schema/posts.ts says why), so Postgres answers a page by scanning one backward from the cursor.
 *
 * @example const posts = keyset(post); db.select({ ...cols, cursorAt: posts.cursorAt }).from(post).where(posts.after(page.cursor)).orderBy(...posts.newestFirst).limit(page.limit + 1)
 */
export const keyset = (table: { readonly createdAt: PgColumn; readonly id: PgColumn }): Keyset => ({
  cursorAt: sql<string>`to_char(${table.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
  // A row-value comparison, which Postgres answers from the (…, created_at, id) indexes: the scan starts right
  // after the cursor instead of skipping over an offset.
  after: (cursor) =>
    cursor
      ? sql`(${table.createdAt}, ${table.id}) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`
      : undefined,
  newestFirst: [desc(table.createdAt), desc(table.id)],
})

/** A row of a keyset query: its id and its `cursorAt`. */
interface KeyedRow {
  readonly id: string
  readonly cursorAt: string
}

/**
 * The page of `rows`, which come from a keyset query with `limit + 1`: the extra row only tells whether another page
 * exists, and the last row shown gives the next cursor.
 */
export const toPage = <Row extends KeyedRow, Item>(
  rows: ReadonlyArray<Row>,
  limit: number,
  toItem: (row: Row) => Item,
): { readonly items: Array<Item>; readonly nextCursor: PageCursor | null } => {
  const shown = rows.slice(0, limit)
  const last = shown.at(-1)
  return {
    items: shown.map((row) => toItem(row)),
    nextCursor: rows.length > limit && last ? { createdAt: last.cursorAt, id: last.id } : null,
  }
}
