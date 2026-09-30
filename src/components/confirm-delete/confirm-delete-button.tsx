import { lazy, Suspense, useRef, useState } from 'react'
import type { DeletedItem } from '#/components/confirm-delete/confirm-delete-dialog.tsx'
import { Button } from '#/components/ui/button.tsx'

// The dialog and Radix's dialog code load on the first hover or focus of a Delete button, not with the page:
// preloaded with the dashboard, they delayed its first paint on a throttled phone (Lighthouse FCP).
const loadDialog = () =>
  import('#/components/confirm-delete/confirm-delete-dialog.tsx').then((module) => ({
    default: module.ConfirmDeleteDialog,
  }))
const ConfirmDeleteDialog = lazy(loadDialog)
const preloadDialog = () => {
  // A failed early load is retried by the lazy component when the dialog opens.
  loadDialog().catch(() => {})
}

/**
 * Delete, asked first (ConfirmDeleteDialog). Focus returns here when the dialog closes, and the deletion only starts
 * then; the button stays (aria-disabled, like every pending button) while the request runs, and the caller moves
 * focus on once the item is gone (as MyPost's `onDeleted` does).
 */
export function ConfirmDeleteButton(props: { target: DeletedItem; pending: boolean; onConfirm: () => void }) {
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
        Delete<span className="sr-only"> {`${props.target.noun}: ${props.target.text.slice(0, 40)}`}</span>
      </Button>
      {asked ? (
        <Suspense fallback={null}>
          <ConfirmDeleteDialog
            target={props.target}
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
