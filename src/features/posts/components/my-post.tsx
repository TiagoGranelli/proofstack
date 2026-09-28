import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { ApiErrorAlert } from '#/components/errors/api-error-alert.tsx'
import { Button } from '#/components/ui/button.tsx'
import { isPostNotFound, useDeletePost } from '#/features/posts/api/delete-post.ts'
import { DeletePostButton } from '#/features/posts/components/delete-post-button.tsx'
import { PostCard } from '#/features/posts/components/post-card.tsx'
import type { Post } from '#/sdk/types.gen.ts'

// The editor loads on the first hover or focus of an Edit button, not with the dashboard, whose first paint on a
// throttled phone counts every preloaded byte (Lighthouse FCP).
const loadEditor = () =>
  import('#/features/posts/components/edit-post-form.tsx').then((module) => ({ default: module.EditPostForm }))
const EditPostForm = lazy(loadEditor)
const preloadEditor = () => {
  // A failed early load is retried by the lazy component when the editor opens.
  loadEditor().catch(() => {})
}

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
      <Suspense fallback={<PostCard post={post} busy />}>
        <EditPostForm
          post={post}
          onClose={() => {
            returnFocus.current = true
            setEditing(false)
          }}
          onUpdated={props.onUpdated}
        />
      </Suspense>
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
            onPointerEnter={preloadEditor}
            onFocus={preloadEditor}
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
