import { sql } from 'drizzle-orm'
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { POST_MAX_LENGTH } from '../../../contract/limits.ts'
import { user } from './auth.ts'

export const post = pgTable(
  'post',
  {
    // Postgres 18's time-ordered UUIDs: new rows land at the right edge of the primary key index instead of on a
    // random page. Rows from before 0006 keep their random (v4) ids. The lists still sort by created_at: see
    // docs/decisions/0013-uuidv7-ids-keyset-on-created-at.md.
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    authorId: text('author_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    // The database's clock, like created_at: an app server's clock could put an edit before its creation.
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => sql`now()`),
  },
  (t) => [
    // Lists are read newest first in keyset pages: ORDER BY created_at DESC, id DESC (the id breaks ties) and
    // WHERE (created_at, id) < cursor, which Postgres answers by scanning these indexes backward, so a page reads
    // only its own rows. Ascending, because posts arrive in increasing time: new entries fill the rightmost leaf
    // (about 90% dense), where a descending index splits its leftmost leaf in half on every page of inserts.
    // Public feed (PostsRepo.listPublic).
    index('post_keyset_idx').on(t.createdAt, t.id),
    // An author's posts (PostsRepo.listByAuthor); also serves the author_id foreign key.
    index('post_author_keyset_idx').on(t.authorId, t.createdAt, t.id),
    // The contract's PostInput rule, as a backstop for writes that bypass the API. Never stricter than the API:
    // char_length counts code points, JavaScript's length UTF-16 units (an emoji is 1 here, 2 there), and btrim
    // strips spaces only, where the API rejects any leading or trailing whitespace.
    check(
      'post_body_check',
      // A constant from the contract, inlined because DDL takes no parameters.
      // fallow-ignore-next-line security-sink
      sql`char_length(${t.body}) between 1 and ${sql.raw(String(POST_MAX_LENGTH))} and ${t.body} = btrim(${t.body})`,
    ),
  ],
)
