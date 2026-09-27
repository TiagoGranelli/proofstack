import { revalidateLogic } from '@tanstack/react-form'
import { useEffect, useRef, useState } from 'react'
import { ApiErrorAlert } from '#/components/errors/api-error-alert.tsx'
import { useAppForm } from '#/components/form/app-form.ts'
import { describedBy, fieldErrorMessage } from '#/components/form/field-messages.ts'
import { FieldError } from '#/components/form/fields.tsx'
import { loadOnInteraction, useSchemaSubmit } from '#/components/form/lazy-schema.ts'
import { Button } from '#/components/ui/button.tsx'
import { Label } from '#/components/ui/label.tsx'
import { Textarea } from '#/components/ui/textarea.tsx'
import { isPostNotFound, useDeletePost } from '#/features/posts/api/delete-post.ts'
import { useUpdatePost } from '#/features/posts/api/update-post.ts'
import { CharacterCount, isTooLong } from '#/features/posts/components/character-count.tsx'
import { DeletePostButton } from '#/features/posts/components/delete-post-button.tsx'
import { PostCard } from '#/features/posts/components/post-card.tsx'
import { postDraftSchema } from '#/features/posts/utils/post-draft-schema.ts'
import { fieldIssue } from '#/lib/api-error.ts'
import type { Post } from '#/sdk/types.gen.ts'

/**
 * One of the author's posts, with Edit and Delete. Edit swaps the body for a form; focus moves into the
 * textarea and returns to the Edit button on Save or Cancel. Delete asks first (DeletePostButton).
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
            Edit<span className="sr-only"> post: {post.body.slice(0, 40)}</span>
          </Button>
          <DeletePostButton
            body={post.body}
            pending={remove.isPending}
            onConfirm={() => remove.mutate({ path: { id: post.id } })}
          />
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

interface EditPostProps {
  readonly post: Post
  readonly onClose: () => void
  readonly onUpdated: (() => void) | undefined
}

/** The update mutation and the form it submits: a save closes the form, then tells the list. */
function useEditPost(props: EditPostProps) {
  const update = useUpdatePost({
    mutationConfig: {
      onSuccess: () => {
        props.onClose()
        props.onUpdated?.()
      },
    },
  })
  const form = useAppForm({
    defaultValues: { body: props.post.body },
    validationLogic: revalidateLogic(),
    validators: { onDynamic: postDraftSchema.validator },
    onSubmit: ({ value }) => update.mutate({ path: { id: props.post.id }, body: postDraftSchema.decode(value) }),
  })
  return { form, update }
}

/** The editor's row under the textarea: the character count, Cancel and Save. */
function EditPostActions(props: { countId: string; draft: string; saving: boolean; onCancel: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <CharacterCount id={props.countId} value={props.draft} />
      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={props.onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={props.draft.trim().length === 0} aria-disabled={props.saving || undefined}>
          Save
        </Button>
      </div>
    </div>
  )
}

/**
 * The form that replaces a post's body while it is edited. It starts from the saved body with the caret at
 * its end; Save, Cancel and Escape close it through `onClose`. Each opening mounts it afresh, so a cancelled
 * draft or a failed save never shows up again. Checked like the composer: in the browser with the API's rules,
 * a ValidationError next to the field, any other failure under the form.
 */
function EditPostForm(props: EditPostProps) {
  const { post } = props
  const textarea = useRef<HTMLTextAreaElement>(null)
  const { form, update } = useEditPost(props)

  useEffect(() => {
    const field = textarea.current
    field?.focus()
    field?.setSelectionRange(field.value.length, field.value.length)
  }, [])

  const fieldId = `edit-post-${post.id}`
  const { submit, schemaError } = useSchemaSubmit(form, postDraftSchema)
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
          submit(event.currentTarget)
        }}
        {...loadOnInteraction(postDraftSchema)}
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
                    schemaError && `${fieldId}-schema-error`,
                  )}
                  aria-invalid={isTooLong(draft) || Boolean(error) || undefined}
                  required
                />
                <EditPostActions
                  countId={`${fieldId}-count`}
                  draft={draft}
                  saving={update.isPending}
                  onCancel={props.onClose}
                />
                <FieldError id={`${fieldId}-error`} message={error} />
              </>
            )
          }}
        </form.AppField>
        {formError ? <ApiErrorAlert id={`${fieldId}-alert`} error={formError} action="save the post" /> : null}
        <FieldError id={`${fieldId}-schema-error`} message={schemaError} />
      </form>
    </PostCard>
  )
}
