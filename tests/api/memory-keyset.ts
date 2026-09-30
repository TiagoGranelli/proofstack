// The keyset pages of src/server/db/keyset.ts in memory, for the api layer's fake repositories (./posts-repo.ts).
// tests/db/keyset.test.ts checks that they order rows as Postgres does.
import type { PageCursor } from '#/contract/pages.ts'
import type { PageRequest } from '#/server/db/keyset.ts'

/** A stored row: its id and its sort key at Postgres's microsecond precision (`cursorAt` of the real query). */
export interface KeyedRow {
  readonly id: string
  readonly cursorAt: string
}

/** Postgres compares uuids bytewise, which for lower-case hex is string order. */
const compare = (a: string, b: string) => {
  if (a === b) return 0
  return a < b ? -1 : 1
}
const compareKeys = (a: PageCursor, b: PageCursor) =>
  compare(a.createdAt, b.createdAt) || compare(a.id.toLowerCase(), b.id.toLowerCase())
const keyOf = (row: KeyedRow): PageCursor => ({ createdAt: row.cursorAt, id: row.id })

/**
 * One page like the real query: the first `limit` rows with a key below the cursor, newest first, shown with
 * `view`, and the last one's key when more remain.
 */
export const memoryPage = <Row extends KeyedRow, Item>(
  rows: ReadonlyArray<Row>,
  { cursor, limit }: PageRequest,
  view: (row: Row) => Item,
) => {
  const after = rows
    .filter((row) => cursor === undefined || compareKeys(keyOf(row), cursor) < 0)
    .toSorted((a, b) => compareKeys(keyOf(b), keyOf(a)))
  const shown = after.slice(0, limit)
  const last = shown.at(-1)
  return { items: shown.map((row) => view(row)), nextCursor: after.length > limit && last ? keyOf(last) : null }
}

/**
 * A clock that advances `stepMicros` per call from 2026-01-01, as the database's `now()` of successive writes: the
 * wire timestamp (milliseconds, as `toISOString` rounds a JS Date) and the full-precision sort key.
 */
export const memoryClock = (stepMicros: number) => {
  const start = Date.UTC(2026, 0, 1)
  let micros = 0
  return () => {
    micros += stepMicros
    const iso = new Date(start + Math.floor(micros / 1000)).toISOString()
    return { iso, key: `${iso.slice(0, 23)}${String(micros % 1000).padStart(3, '0')}Z` }
  }
}
