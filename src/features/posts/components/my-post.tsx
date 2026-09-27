import { revalidateLogic } from '@tanstack/react-form'
import { useEffect, useRef, useState } from 'react'
import { ApiErrorAlert } from '#/components/errors/api-error-alert.tsx'
import { useAppForm } from '#/components/form/app-form.ts'
import { describedBy, fieldErrorMessage, focusFirstInvalid } from '#/components/form/field-messages.ts'
import { FieldError } from '#/components/form/fields.tsx'
import { Button } from '#/components/ui/button.tsx'
import { Label } from '#/components/ui/label.tsx'
import { Textarea } from '#/components/ui/textarea.tsx'
import { isPostNotFound, useDeletePost } from '#/features/posts/api/delete-post.ts'
import { useUpdatePost } from '#/features/posts/api/update-post.ts'
import { CharacterCount, isTooLong } from '#/features/posts/components/character-count.tsx'
import { PostCard } from '#/features/posts/components/post-card.tsx'
import { postDraftValidator, toPostInput } from '#/features/posts/utils/post-draft.ts'
import { fieldIssue } from '#/lib/api-error.ts'
import type { Post } from '#/sdk/types.gen.ts'

/**
 * One of the author's posts, with Edit and Delete. Edit swaps the body for a form; focus moves into the
 * textarea and returns to the Edit button on Save or Cancel.
 */
export function MyPost(props: { post: Post; onUpdated?: () => void; onDeleted?: () => void }) {
  const { post } = props
  const [editing, setEditing] = useState(false)
  const editButton = useRef<HTMLButtonElement>(null)
  const returnFocus = useRef(false)
  const remove = useDeletePost({ mutationConfig: { onSuccess: () => props.onDeleted?.() } })

  useEffect(() => {
    if (!editing && returnFocus.current) {
      returnFocus.current = false
      editButton.current?.focus()
    }
  }, [editing])

  if (editing) {
    return (
      <EditPostForm
        post={post}
        onClose={() => {
          returnFocus.current = true
          setEditing(false)
        }}
        onUpdated={props.onUpdated}
      />
    )
  }

  const label = <span className="sr-only"> post: {post.body.slice(0, 40)}</span>
  return (
    <PostCard
      post={post}
      busy={remove.isPending}
      actions={
        <>
          <Button
            ref={editButton}
            type="button"
            variant="ghost"
            size="sm"
            aria-disabled={remove.isPending || undefined}
            onClick={() => {
              if (!remove.isPending) setEditing(true)
            }}
          >
            Edit{label}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-disabled={remove.isPending || undefined}
            onClick={() => {
              if (!remove.isPending) remove.mutate({ path: { id: post.id } })
            }}
          >
            Delete{label}
          </Button>
        </>
      }
      alert={
        remove.isError && !isPostNotFound(remove.error) ? (
          <ApiErrorAlert error={remove.error} action="delete the post" />
        ) : null
      }
    />
  )
}

/**
 * The form that replaces a post's body while it is edited. It starts from the saved body with the caret at
 * its end; Save, Cancel and Escape close it through `onClose`. Each opening mounts it afresh, so a cancelled
 * draft or a failed save never shows up again. Checked like the composer: in the browser with the API's rules,
 * a ValidationError next to the field, any other failure under the form.
 */
function EditPostForm(props: { post: Post; onClose: () => void; onUpdated: (() => void) | undefined }) {
  const { post } = props
  const textarea = useRef<HTMLTextAreaElement>(null)
  const update = useUpdatePost({
    mutationConfig: {
      onSuccess: () => {
        props.onClose()
        props.onUpdated?.()
      },
    },
  })
  const form = useAppForm({
    defaultValues: { body: post.body },
    validationLogic: revalidateLogic(),
    validators: { onDynamic: postDraftValidator },
    onSubmit: ({ value }) => update.mutate({ path: { id: post.id }, body: toPostInput(value) }),
  })

  useEffect(() => {
    const field = textarea.current
    field?.focus()
    field?.setSelectionRange(field.value.length, field.value.length)
  }, [])

  const fieldId = `edit-post-${post.id}`
  const serverIssue = fieldIssue(update.error, 'body')
  const formError = update.isError && serverIssue === undefined ? update.error : null
  return (
    <PostCard post={post}>
      <form
        className="grid gap-2"
        noValidate
        aria-busy={update.isPending}
        onSubmit={(event) => {
          event.preventDefault()
          if (update.isPending) return
          const element = event.currentTarget
          void form.handleSubmit().then(() => focusFirstInvalid(element))
        }}
      >
        <form.AppField name="body">
          {(field) => {
            const draft = field.state.value
            const error = fieldErrorMessage(field.state.meta.errors) ?? serverIssue
            return (
              <>
                <Label htmlFor={fieldId}>Edit post</Label>
                <Textarea
                  id={fieldId}
                  ref={textarea}
                  name={field.name}
                  value={draft}
                  onChange={(event) => field.handleChange(event.target.value)}
                  onBlur={field.handleBlur}
                  onKeyDown={(event) => {
                    if (event.key !== 'Escape') return
                    event.preventDefault()
                    props.onClose()
                  }}
                  aria-describedby={describedBy(
                    `${fieldId}-count`,
                    error && `${fieldId}-error`,
                    formError && `${fieldId}-alert`,
                  )}
                  aria-invalid={isTooLong(draft) || Boolean(error) || undefined}
                  required
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CharacterCount id={`${fieldId}-count`} value={draft} />
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" onClick={props.onClose}>
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      disabled={draft.trim().length === 0}
                      aria-disabled={update.isPending || undefined}
                    >
                      Save
                    </Button>
                  </div>
                </div>
                <FieldError id={`${fieldId}-error`} message={error} />
              </>
            )
          }}
        </form.AppField>
        {formError ? <ApiErrorAlert id={`${fieldId}-alert`} error={formError} action="save the post" /> : null}
      </form>
    </PostCard>
  )
}
