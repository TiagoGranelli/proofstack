import { Schema } from 'effect'
import { POST_MAX_LENGTH } from './limits.ts'

/**
 * A post's body as the API takes it. Apart from the endpoints in ./posts.ts so the post forms can validate with
 * it in the browser without loading the HttpApi code. The messages reach users twice: in the forms before they
 * send, and in a ValidationError's issues when another client sends a body that breaks them.
 */
export const PostBody = Schema.String.check(
  Schema.isTrimmed({ message: 'Remove the spaces before and after the text.' }),
  Schema.isMinLength(1, { message: 'Write something to post.' }),
  Schema.isMaxLength(POST_MAX_LENGTH, { message: `Use at most ${POST_MAX_LENGTH} characters.` }),
)

export const PostInput = Schema.Struct({ body: PostBody }).annotate({ identifier: 'PostInput' })
