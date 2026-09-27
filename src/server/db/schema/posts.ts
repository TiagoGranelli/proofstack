import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { user } from './auth.ts'

export const post = pgTable(
  'post',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    authorId: text('author_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // Lists are read newest first in keyset pages: ORDER BY created_at DESC, id DESC (the id breaks ties) and
    // WHERE (created_at, id) < cursor. Both indexes answer the order and the cursor condition, so a page reads
    // only its own rows. NULLS FIRST is what `DESC` means in an ORDER BY; drizzle-kit's default for `.desc()`
    // in an index is NULLS LAST, which Postgres cannot use for that order even on NOT NULL columns.
    // Public feed (PostsRepo.listPublic).
    index('post_created_id_idx').on(t.createdAt.desc().nullsFirst(), t.id.desc().nullsFirst()),
    // An author's posts (PostsRepo.listByAuthor); also serves the author_id foreign key.
    index('post_author_created_id_idx').on(t.authorId, t.createdAt.desc().nullsFirst(), t.id.desc().nullsFirst()),
  ],
)
