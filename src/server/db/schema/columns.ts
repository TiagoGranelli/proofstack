// The columns and the text CHECK every table of user content shares (post; the next one alike), so a new table
// declares only what is its own. Not a table: index.ts does not export it, and drizzle-kit reads no DDL from it.
import { sql } from 'drizzle-orm'
import { type AnyPgColumn, check, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { user } from './auth.ts'

/**
 * Postgres 18's time-ordered UUIDs: new rows land at the right edge of the primary key index instead of on a random
 * page. Lists still sort by created_at: see docs/decisions/0014-uuidv7-ids-keyset-on-created-at.md.
 */
export const uuidv7Id = () =>
  uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`)

/** The account that wrote the row; deleting the account deletes the row. */
export const authorId = () =>
  text('author_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' })

/** When the row was written, by the database's clock: the keyset lists sort by it (src/server/db/keyset.ts). */
export const createdAt = () => timestamp('created_at', { withTimezone: true }).defaultNow().notNull()

/** The database's clock, like created_at: an app server's clock could put an edit before its creation. */
export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => sql`now()`)

/**
 * The contract's rule for a user's text (1 to `maxLength` characters, trimmed), as a backstop for writes that bypass
 * the API. Never stricter than the API: char_length counts code points, JavaScript's length UTF-16 units (an emoji is
 * 1 here, 2 there), and btrim strips spaces only, where the API rejects any leading or trailing whitespace.
 */
export const trimmedTextCheck = (name: string, column: AnyPgColumn, maxLength: number) =>
  check(
    name,
    // A constant from the contract, inlined because DDL takes no parameters.
    // fallow-ignore-next-line security-sink
    sql`char_length(${column}) between 1 and ${sql.raw(String(maxLength))} and ${column} = btrim(${column})`,
  )
