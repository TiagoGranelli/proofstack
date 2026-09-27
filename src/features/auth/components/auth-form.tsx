import { useHydrated } from '@tanstack/react-router'
import type { ComponentProps, ReactNode } from 'react'
import { Button } from '#/components/ui/button.tsx'
import { Input } from '#/components/ui/input.tsx'
import { Label } from '#/components/ui/label.tsx'
import { describeAuthFailure } from '#/features/auth/utils/describe-auth-failure.ts'

/**
 * A form for an account action. Its button stays disabled until hydration: a native submit before that would
 * post the fields (passwords included) to the page itself. While the action is pending the button is only
 * `aria-disabled` and further submits are ignored: a disabled button loses focus, so a keyboard user who
 * pressed it would be dropped to <body> when the attempt fails. A failure is shown in an alert under the button.
 */
export function AuthForm(props: {
  /** Prefix for the ids this form gives its alert. */
  id: string
  submitLabel: string
  submitVariant?: 'default' | 'destructive'
  pending: boolean
  /** The mutation's error, if the last attempt failed. */
  error: unknown
  onSubmit: (form: FormData) => void
  children: ReactNode
}) {
  const hydrated = useHydrated()
  const errorId = `${props.id}-error`
  return (
    <form
      method="post"
      className="grid gap-3"
      aria-busy={props.pending}
      aria-describedby={props.error ? errorId : undefined}
      onSubmit={(event) => {
        event.preventDefault()
        if (!props.pending) props.onSubmit(new FormData(event.currentTarget))
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

/** A labelled input; `hint` is read out with the field. */
export function AuthField({
  label,
  hint,
  ...input
}: ComponentProps<'input'> & { id: string; label: string; hint?: string }) {
  const hintId = hint ? `${input.id}-hint` : undefined
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={input.id}>{label}</Label>
      <Input {...input} aria-describedby={hintId} />
      {hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  )
}
