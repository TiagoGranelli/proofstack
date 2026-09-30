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

/** What a Delete button removes, as its label and its dialog name it. */
export interface DeletedItem {
  /** Names the kind of item: `post` gives "Delete post: …" and "Delete this post?". */
  readonly noun: string
  /** The item's text: quoted in the dialog, and its start names the button for screen readers. */
  readonly text: string
  /** What deleting it means, under the dialog's title. */
  readonly consequence: string
}

/**
 * The question Delete asks (ConfirmDeleteButton loads it on demand): an alert dialog (Radix: focus trapped inside,
 * Escape and Keep it close it). Keep it has the initial focus, so Enter alone never deletes. On close, focus goes
 * back to `returnFocus`, and only then does a confirmed deletion start, so focus is on a button that exists while
 * the request runs.
 */
export function ConfirmDeleteDialog(props: {
  target: DeletedItem
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
          <AlertDialogTitle>Delete this {props.target.noun}?</AlertDialogTitle>
          <AlertDialogDescription>{props.target.consequence}</AlertDialogDescription>
        </AlertDialogHeader>
        <blockquote className="border-l-2 pl-3 text-sm break-words whitespace-pre-wrap">{props.target.text}</blockquote>
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
