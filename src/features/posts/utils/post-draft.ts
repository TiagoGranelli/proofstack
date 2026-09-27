import { Schema, SchemaTransformation } from 'effect'
import { PostBody } from '#/contract/post-input.ts'

/**
 * A post form's value: the text as typed, which the form sends trimmed. Decoding trims it and applies the API's own
 * PostBody checks, so the form flags in the browser what the API would refuse, with the same messages. The forms
 * load it on first interaction (`postDraftSchema`), so it is only imported dynamically.
 */
export const PostDraft = Schema.Struct({
  body: Schema.String.pipe(Schema.decodeTo(PostBody, SchemaTransformation.trim())),
})
