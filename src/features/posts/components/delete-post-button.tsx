import { lazy, Suspense, useRef, useState } from 'react'
import { Button } from '#/components/ui/button.tsx'

// The dialog and Radix's dialog code load on the first hover or focus of a Delete button, not with the dashboard:
// preloaded with the page, they delayed its first paint on a throttled phone (Lighthouse FCP).
const loadDialog = () =>
  import('#/features/posts/components/delete-post-dialog.tsx').then((module) => ({ default: module.DeletePostDialog }))
const DeletePostDialog = lazy(loadDialog)
const preloadDialog = () => {
  // A failed early load is retried by the lazy component when the dialog opens.
  loadDialog().catch(() => {})
}

/**
 * Delete, asked first (DeletePostDialog). Focus returns here when the dialog closes, and the deletion only starts
 * then; the button stays (aria-disabled, like every pending button) while the request runs, and the page moves
 * focus on once the post is gone (`onDeleted` in MyPost).
 */
export function DeletePostButton(props: { body: string; pending: boolean; onConfirm: () => void }) {
  const button = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  // Mounted from the first opening on, so closing runs Radix's close (and its focus return) instead of unmounting.
  const [asked, setAsked] = useState(false)
  return (
    <>
      <Button
        ref={button}
        type="button"
        variant="ghost"
        size="sm"
        aria-disabled={props.pending || undefined}
        aria-haspopup="dialog"
        onPointerEnter={preloadDialog}
        onFocus={preloadDialog}
        onClick={() => {
          if (props.pending) return
          setAsked(true)
          setOpen(true)
        }}
      >
        Delete<span className="sr-only"> post: {props.body.slice(0, 40)}</span>
      </Button>
      {asked ? (
        <Suspense fallback={null}>
          <DeletePostDialog
            body={props.body}
            open={open}
            onOpenChange={setOpen}
            onConfirm={props.onConfirm}
            returnFocus={button}
          />
        </Suspense>
      ) : null}
    </>
  )
}
