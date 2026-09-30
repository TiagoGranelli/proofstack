import { revalidateLogic, useForm } from '@tanstack/react-form'
import { useRef } from 'react'
import { ApiErrorAlert } from '#/components/errors/api-error-alert.tsx'
import { CharacterCount, isTooLong } from '#/components/form/character-count.tsx'
import { FieldError } from '#/components/form/field-error.tsx'
import { describedBy, fieldErrorMessage } from '#/components/form/field-messages.ts'
import { loadOnInteraction, useSchemaSubmit } from '#/components/form/lazy-schema.ts'
import { Button } from '#/components/ui/button.tsx'
import { Label } from '#/components/ui/label.tsx'
import { Textarea } from '#/components/ui/textarea.tsx'
import { POST_MAX_LENGTH } from '#/contract/limits.ts'
import { useCreatePost } from '#/features/posts/api/create-post.ts'
import { postDraftSchema } from '#/features/posts/utils/post-draft-schema.ts'
import { fieldIssue } from '#/lib/api-error.ts'

/**
 * Writes a new post. The draft is checked in the browser with the API's own rules before it is sent; a
 * ValidationError the API still answers lands next to the field it names, any other failure under the form.
 * After publishing, focus returns to the emptied field, ready for the next post: Publish, which had it, is
 * disabled until there is text again, and a disabled button drops focus to <body>. The page announces the
 * success (`onPublished`).
 */
export function PostComposer(props: { onPublished?: () => void }) {
  const textarea = useRef<HTMLTextAreaElement>(null)
  const create = useCreatePost({
    mutationConfig: {
      onSuccess: () => {
        form.reset()
        textarea.current?.focus()
        props.onPublished?.()
      },
    },
  })
  const form = useForm({
    defaultValues: { body: '' },
    validationLogic: revalidateLogic(),
    validators: { onDynamic: postDraftSchema.validator },
    onSubmit: ({ value }) => create.mutate({ body: postDraftSchema.decode(value) }),
  })
  const { submit, schemaError } = useSchemaSubmit(form, postDraftSchema)
  const serverIssue = fieldIssue(create.error, 'body')
  const formError = create.isError && serverIssue === undefined ? create.error : null
  return (
    <form
      className="grid gap-2"
      noValidate
      aria-busy={create.isPending}
      onSubmit={(event) => {
        event.preventDefault()
        // Publish stays focusable while pending (aria-disabled, see below), so a second press lands here.
        if (create.isPending) return
        submit(event.currentTarget)
      }}
      {...loadOnInteraction(postDraftSchema)}
    >
      <form.Field name="body">
        {(field) => {
          const body = field.state.value
          const error = fieldErrorMessage(field.state.meta.errors) ?? serverIssue
          return (
            <>
              <Label htmlFor="post-body">New post</Label>
              <Textarea
                id="post-body"
                ref={textarea}
                name={field.name}
                value={body}
                onChange={(event) => field.handleChange(event.target.value)}
                onBlur={field.handleBlur}
                aria-describedby={describedBy(
                  'post-body-count',
                  error && 'post-body-error',
                  formError && 'post-error',
                  schemaError && 'post-schema-error',
                )}
                aria-invalid={isTooLong(body, POST_MAX_LENGTH) || Boolean(error) || undefined}
                required
              />
              <div className="flex items-center justify-between gap-2">
                <CharacterCount id="post-body-count" value={body} max={POST_MAX_LENGTH} />
                {/* Only aria-disabled while pending: a disabled button loses focus, and a keyboard user would be left
                    on <body> when publishing fails. */}
                <Button type="submit" disabled={body.trim().length === 0} aria-disabled={create.isPending || undefined}>
                  Publish
                </Button>
              </div>
              <FieldError id="post-body-error" message={error} />
            </>
          )
        }}
      </form.Field>
      {formError ? <ApiErrorAlert id="post-error" error={formError} action="publish the post" /> : null}
      <FieldError id="post-schema-error" message={schemaError} />
    </form>
  )
}
