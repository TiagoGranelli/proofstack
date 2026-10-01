import { Schema } from 'effect'

// One brand per kind of id. An id is a string at run time and in the OpenAPI document; the brand exists only for
// the compiler, which then refuses a user's id where a post's is expected (`eq(post.id, author.id)` does not
// compile). A new table gets its brand here and puts it on its columns with `.$type<...>()`.

/** A user's id: Better Auth's `user.id`. */
export const UserId = Schema.String.pipe(Schema.brand('UserId'))
export type UserId = typeof UserId.Type

/** A post's id: `post.id`, a UUID. */
export const PostId = Schema.String.pipe(Schema.brand('PostId'))
export type PostId = typeof PostId.Type
