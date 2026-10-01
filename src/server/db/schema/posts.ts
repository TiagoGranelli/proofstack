import { index, pgTable, text } from 'drizzle-orm/pg-core'
import type { PostId } from '../../../contract/ids.ts'
import { POST_MAX_LENGTH } from '../../../contract/limits.ts'
import { authorId, createdAt, trimmedTextCheck, updatedAt, uuidv7Id } from './columns.ts'

export const post = pgTable(
  'post',
  {
    // Rows from before 0007 keep their random (v4) ids.
    id: uuidv7Id().$type<PostId>(),
    authorId: authorId(),
    body: text('body').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
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
    // The contract's PostInput rule (src/contract/post-input.ts).
    trimmedTextCheck('post_body_check', t.body, POST_MAX_LENGTH),
  ],
)
