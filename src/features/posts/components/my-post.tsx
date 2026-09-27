import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { ApiErrorAlert } from '#/components/errors/api-error-alert.tsx'
import { Button } from '#/components/ui/button.tsx'
import { Label } from '#/components/ui/label.tsx'
import { Textarea } from '#/components/ui/textarea.tsx'
import { dropMyPost, invalidatePosts, replaceMyPost } from '#/features/posts/api/posts-cache.ts'
import { CharacterCount, isTooLong } from '#/features/posts/components/character-count.tsx'
import { PostCard } from '#/features/posts/components/post-list.tsx'
import { apiErrorTag } from '#/lib/api-error.ts'
import { myPostsRemoveMutation, myPostsUpdateMutation } from '#/sdk/@tanstack/react-query.gen.ts'
import type { Post } from '#/sdk/types.gen.ts'

const isPostNotFound = (error: unknown) => apiErrorTag(error) === 'PostNotFound'

/**
 * One of the author's posts, with Edit and Delete. Edit swaps the body for a form; focus moves into the
 * textarea and returns to the Edit button on Save or Cancel.
 */
export function MyPost(props: { post: Post; onUpdated?: () => void; onDeleted?: () => void }) {
  const { post } = props
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(post.body)
  const editButton = useRef<HTMLButtonElement>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const returnFocus = useRef(false)

  const update = useMutation({
    ...myPostsUpdateMutation(),
    onSuccess: async (saved) => {
      replaceMyPost(queryClient, saved)
      returnFocus.current = true
      setEditing(false)
      props.onUpdated?.()
      await invalidatePosts(queryClient)
    },
  })
  const remove = useMutation({
    ...myPostsRemoveMutation(),
    onSuccess: async () => {
      dropMyPost(queryClient, post.id)
      props.onDeleted?.()
      await invalidatePosts(queryClient)
    },
    // Already gone (deleted in another tab): the refetch removes it from the list.
    onError: async (error) => {
      if (isPostNotFound(error)) await invalidatePosts(queryClient)
    },
  })

  useEffect(() => {
    if (editing) {
      const field = textarea.current
      field?.focus()
      field?.setSelectionRange(field.value.length, field.value.length)
    } else if (returnFocus.current) {
      returnFocus.current = false
      editButton.current?.focus()
    }
  }, [editing])

  const cancel = () => {
    returnFocus.current = true
    setEditing(false)
    update.reset()
  }
  const label = <span className="sr-only"> post: {post.body.slice(0, 40)}</span>

  if (editing) {
    const fieldId = `edit-post-${post.id}`
    return (
      <PostCard post={post}>
        <form
          className="grid gap-2"
          aria-busy={update.isPending}
          onSubmit={(event) => {
            event.preventDefault()
            update.mutate({ path: { id: post.id }, body: { body: draft.trim() } })
          }}
        >
          <Label htmlFor={fieldId}>Edit post</Label>
          <Textarea
            id={fieldId}
            ref={textarea}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                cancel()
              }
            }}
            aria-describedby={update.isError ? `${fieldId}-count ${fieldId}-error` : `${fieldId}-count`}
            aria-invalid={isTooLong(draft) || update.isError || undefined}
            required
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CharacterCount id={`${fieldId}-count`} value={draft} />
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={cancel}>
                Cancel
              </Button>
              <Button type="submit" disabled={update.isPending || draft.trim().length === 0}>
                Save
              </Button>
            </div>
          </div>
          {update.isError ? (
            <ApiErrorAlert id={`${fieldId}-error`} error={update.error} action="save the post" />
          ) : null}
        </form>
      </PostCard>
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
            disabled={remove.isPending}
            onClick={() => {
              setDraft(post.body)
              update.reset()
              setEditing(true)
            }}
          >
            Edit{label}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={remove.isPending}
            onClick={() => remove.mutate({ path: { id: post.id } })}
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
