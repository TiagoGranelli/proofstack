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
    // Public feed: newest first.
    index('post_created_at_idx').on(t.createdAt.desc()),
    // An author's posts, newest first (PostsRepo.listByAuthor); also serves the author_id foreign key.
    index('post_author_created_idx').on(t.authorId, t.createdAt.desc()),
  ],
)
