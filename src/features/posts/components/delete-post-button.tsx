import { useRef } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '#/components/ui/alert-dialog.tsx'
import { Button } from '#/components/ui/button.tsx'

/**
 * Delete, asked first in an alert dialog (Radix: focus trapped inside, Escape and Cancel close it, focus returns to
 * this button). Cancel has the initial focus, so Enter alone never deletes. The deletion starts once the dialog
 * has closed and put focus back here, so focus is on a button that exists while the request runs (aria-disabled,
 * like every pending button); the page moves it on when the post is gone (`onDeleted` in MyPost).
 */
export function DeletePostButton(props: { body: string; pending: boolean; onConfirm: () => void }) {
  const confirmed = useRef(false)
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-disabled={props.pending || undefined}
          onClick={(event) => {
            // Radix skips opening when the press was prevented.
            if (props.pending) event.preventDefault()
          }}
        >
          Delete<span className="sr-only"> post: {props.body.slice(0, 40)}</span>
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent
        onCloseAutoFocus={() => {
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
