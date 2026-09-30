// The shared list plumbing on real Postgres, on a table of its own built from the shared columns
// (src/server/db/schema/columns.ts): keyset pages (src/server/db/keyset.ts) that never skip or repeat a row, even
// rows written in the same microsecond, in the order the api layer's fake uses (tests/api/memory-keyset.ts); the
// uuidv7 id; and the text CHECK. The posts table has its own checks (post-schema.test.ts).
import { PgDialect, getTableConfig, pgTable, text } from 'drizzle-orm/pg-core'
import { Effect } from 'effect'
import type { DatabaseError } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PageCursor } from '#/contract/pages.ts'
import { db, pool } from '#/server/db/client.ts'
import { keyset, toPage } from '#/server/db/keyset.ts'
import { query } from '#/server/db/query.ts'
import { authorId, createdAt, trimmedTextCheck, updatedAt, uuidv7Id } from '#/server/db/schema/columns.ts'
import { memoryPage } from '../api/memory-keyset.ts'
import { createAccount } from './helpers.ts'

const note = pgTable(
  'keyset_test_note',
  {
    id: uuidv7Id(),
    authorId: authorId(),
    body: text('body').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [trimmedTextCheck('keyset_test_note_body_check', t.body, 10)],
)
const notes = keyset(note)

/** The table's CHECK as SQL text, rendered from the shared helper, so the test runs the constraint it defines. */
const checkSql = () => {
  const [bodyCheck] = getTableConfig(note).checks
  return new PgDialect().sqlToQuery(bodyCheck!.value).sql
}

let author: { id: string }
beforeAll(async () => {
  author = await createAccount('keyset')
  await pool.query(`create table keyset_test_note (
    id uuid primary key default uuidv7(),
    author_id text not null references "user" (id) on delete cascade,
    body text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint keyset_test_note_body_check check (${checkSql()})
  )`)
})
afterAll(async () => {
  await pool.query('drop table if exists keyset_test_note')
  await pool.end()
})

/** One page of the notes, as a repository reads it. */
const pageAfter = (cursor: PageCursor | undefined, limit: number) =>
  Effect.runPromise(
    query(db, (client) =>
      client
        .select({ id: note.id, body: note.body, cursorAt: notes.cursorAt })
        .from(note)
        .where(notes.after(cursor))
        .orderBy(...notes.newestFirst)
        .limit(limit + 1),
    ),
  ).then((rows) => toPage(rows, limit, (row) => row))

/** Every note, read page by page until the last. */
const readAll = async (limit: number) => {
  const seen: Array<{ id: string; body: string; cursorAt: string }> = []
  let cursor: PageCursor | undefined
  do {
    const page = await pageAfter(cursor, limit)
    seen.push(...page.items)
    cursor = page.nextCursor ?? undefined
  } while (cursor)
  return seen
}

describe('keyset pages', () => {
  it('read every row once, newest first, with ties in one microsecond broken by id, as the fake orders them', async () => {
    // Three in one microsecond, two a microsecond apart within one millisecond, one a second later.
    await pool.query(
      `insert into keyset_test_note (author_id, body, created_at)
         select $1, 'note ' || n, timestamptz '2000-01-01 00:00:00.000100' + make_interval(secs => s)
         from (values (1, 0), (2, 0), (3, 0), (4, 0.000001), (5, 0.000002), (6, 1)) v(n, s)`,
      [author.id],
    )
    const all = await readAll(100)
    expect(all).toHaveLength(6)
    for (const limit of [1, 2, 4]) expect(await readAll(limit)).toEqual(all)
    expect(memoryPage(all.toReversed(), { limit: 100 }, (row) => row).items).toEqual(all)
    expect(all.slice(0, 3).map((row) => row.body)).toEqual(['note 6', 'note 5', 'note 4'])
  })
})

/** Inserts a note with `body`: 'ok', or the SQLSTATE Postgres refuses it with. */
const sqlState = (body: string) =>
  pool.query(`insert into keyset_test_note (author_id, body) values ($1, $2)`, [author.id, body]).then(
    () => 'ok',
    (error: unknown) => (error as DatabaseError).code,
  )

describe('shared columns', () => {
  it('give a new row a time-ordered uuidv7 id and the database clock', async () => {
    const [row] = await db.insert(note).values({ authorId: author.id, body: 'fresh' }).returning()
    expect(row?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(row?.updatedAt).toEqual(row?.createdAt)
  })

  it.each([
    ['empty', '', '23514'],
    ['over the limit', 'a'.repeat(11), '23514'],
    ['untrimmed', ' note', '23514'],
    ['at the limit, counted in code points', '😀'.repeat(10), 'ok'],
  ])('check a text that is %s', async (_, body, state) => {
    expect(await sqlState(body)).toBe(state)
  })
})
