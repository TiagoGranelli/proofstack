import { revalidateLogic } from '@tanstack/react-form'
import { ApiErrorAlert } from '#/components/errors/api-error-alert.tsx'
import { useAppForm } from '#/components/form/app-form.ts'
import { describedBy, fieldErrorMessage, focusFirstInvalid } from '#/components/form/field-messages.ts'
import { FieldError } from '#/components/form/fields.tsx'
import { Button } from '#/components/ui/button.tsx'
import { Label } from '#/components/ui/label.tsx'
import { Textarea } from '#/components/ui/textarea.tsx'
import { useCreatePost } from '#/features/posts/api/create-post.ts'
import { CharacterCount, isTooLong } from '#/features/posts/components/character-count.tsx'
import { postDraftValidator, toPostInput } from '#/features/posts/utils/post-draft.ts'
import { fieldIssue } from '#/lib/api-error.ts'

/**
 * Writes a new post. The draft is checked in the browser with the API's own rules before it is sent; a
 * ValidationError the API still answers lands next to the field it names, any other failure under the form.
 */
export function PostComposer(props: { onPublished?: () => void }) {
  const create = useCreatePost({
    mutationConfig: {
      onSuccess: () => {
        form.reset()
        props.onPublished?.()
      },
    },
  })
  const form = useAppForm({
    defaultValues: { body: '' },
    validationLogic: revalidateLogic(),
    validators: { onDynamic: postDraftValidator },
    onSubmit: ({ value }) => create.mutate({ body: toPostInput(value) }),
  })
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
        const element = event.currentTarget
        void form.handleSubmit().then(() => focusFirstInvalid(element))
      }}
    >
      <form.AppField name="body">
        {(field) => {
          const body = field.state.value
          const error = fieldErrorMessage(field.state.meta.errors) ?? serverIssue
          return (
            <>
              <Label htmlFor="post-body">New post</Label>
              <Textarea
                id="post-body"
                name={field.name}
                value={body}
                onChange={(event) => field.handleChange(event.target.value)}
                onBlur={field.handleBlur}
                aria-describedby={describedBy('post-body-count', error && 'post-body-error', formError && 'post-error')}
                aria-invalid={isTooLong(body) || Boolean(error) || undefined}
                required
              />
              <div className="flex items-center justify-between gap-2">
                <CharacterCount id="post-body-count" value={body} />
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
      </form.AppField>
      {formError ? <ApiErrorAlert id="post-error" error={formError} action="publish the post" /> : null}
    </form>
  )
}
