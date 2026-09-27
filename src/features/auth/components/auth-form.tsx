import { useHydrated } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { focusFirstInvalid } from '#/components/form/field-messages.ts'
import { Button } from '#/components/ui/button.tsx'
import { describeAuthFailure } from '#/features/auth/utils/describe-auth-failure.ts'

/**
 * The shell of an account form made with useAppForm: its fields are the children, validated in the browser with
 * the action's Effect Schema (src/lib/account-input.ts); a failed submit moves focus to the first invalid field.
 * The button stays disabled until hydration: a native submit before that would post the fields (passwords
 * included) to the page itself. While the action is pending the button is only `aria-disabled` and further submits
 * are ignored: a disabled button loses focus, so a keyboard user who pressed it would be dropped to <body> when the
 * attempt fails. A failure the server reports is shown in an alert under the button.
 */
export function AuthForm(props: {
  /** Prefix for the ids this form gives its alert. */
  id: string
  submitLabel: string
  submitVariant?: 'default' | 'destructive'
  /** The form from useAppForm; its onSubmit starts the action. */
  form: { handleSubmit: () => Promise<void> }
  pending: boolean
  /** The action's error, if the last attempt failed. */
  error: Error | null
  children?: ReactNode
}) {
  const hydrated = useHydrated()
  const errorId = `${props.id}-error`
  return (
    <form
      method="post"
      // The fields show the schema's messages; the browser's own bubbles would show different ones first.
      noValidate
      className="grid gap-3"
      aria-busy={props.pending}
      aria-describedby={props.error ? errorId : undefined}
      onSubmit={(event) => {
        event.preventDefault()
        if (props.pending) return
        const element = event.currentTarget
        void props.form.handleSubmit().then(() => focusFirstInvalid(element))
      }}
    >
      {props.children}
      <div>
        <Button
          type="submit"
          variant={props.submitVariant}
          disabled={!hydrated}
          aria-disabled={props.pending || undefined}
        >
          {props.submitLabel}
        </Button>
      </div>
      {props.error ? (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {describeAuthFailure(props.error)}
        </p>
      ) : null}
    </form>
  )
}
