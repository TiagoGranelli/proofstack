import { type RefObject, useRef } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '#/components/ui/alert-dialog.tsx'

/**
 * The question Delete asks (DeletePostButton loads it on demand): an alert dialog (Radix: focus trapped inside,
 * Escape and Keep it close it). Keep it has the initial focus, so Enter alone never deletes. On close, focus goes
 * back to `returnFocus`, and only then does a confirmed deletion start, so focus is on a button that exists while
 * the request runs.
 */
export function DeletePostDialog(props: {
  body: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  returnFocus: RefObject<HTMLButtonElement | null>
}) {
  const confirmed = useRef(false)
  return (
    <AlertDialog open={props.open} onOpenChange={props.onOpenChange}>
      <AlertDialogContent
        onCloseAutoFocus={(event) => {
          // Opened without a Radix trigger, so Radix does not know where focus came from.
          event.preventDefault()
          props.returnFocus.current?.focus()
          if (!confirmed.current) return
          confirmed.current = false
          props.onConfirm()
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this post?</AlertDialogTitle>
          <AlertDialogDescription>
            It will be gone for good, from your posts and from the public list.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <blockquote className="border-l-2 pl-3 text-sm break-words whitespace-pre-wrap">{props.body}</blockquote>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => (confirmed.current = true)}>
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
