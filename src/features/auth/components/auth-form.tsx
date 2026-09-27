import { useHydrated } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { describedBy } from '#/components/form/field-messages.ts'
import { FieldError } from '#/components/form/fields.tsx'
import { loadOnInteraction, useSchemaSubmit } from '#/components/form/lazy-schema.ts'
import { Button } from '#/components/ui/button.tsx'
import { describeAuthFailure } from '#/features/auth/utils/describe-auth-failure.ts'

/**
 * The shell of an account form made with useAppForm: its fields are the children, validated in the browser with
 * the action's Effect Schema (src/lib/account-input.ts), loaded on the first interaction (lazyFormSchema); a failed
 * submit moves focus to the first invalid field.
 * Without an `action` the button stays disabled until hydration: a native submit before that would post the fields
 * (passwords included) to the page itself. While the action is pending the button is only `aria-disabled` and further submits
 * are ignored: a disabled button loses focus, so a keyboard user who pressed it would be dropped to <body> when the
 * attempt fails. A failure the server reports, or a schema that could not be loaded, is shown in an alert under
 * the button.
 */
export function AuthForm(props: {
  /** Prefix for the ids this form gives its alert. */
  id: string
  submitLabel: string
  submitVariant?: 'default' | 'destructive'
  /** The form from useAppForm; its onSubmit starts the action. */
  form: { handleSubmit: () => Promise<void> }
  /** The fields' schema (lazyFormSchema): loaded on the first focus or input, and awaited by a submit. */
  schema?: { load: () => Promise<void> }
  /**
   * Where the browser posts the form itself before hydration (a server function's `url` that takes FormData).
   * With it the button works from the first paint; without it, it waits for hydration.
   */
  action?: string
  pending: boolean
  /** The action's error, if the last attempt failed. */
  error: Error | null
  children?: ReactNode
}) {
  const hydrated = useHydrated()
  const { submit, schemaError } = useSchemaSubmit(props.form, props.schema)
  const errorId = `${props.id}-error`
  const schemaErrorId = `${props.id}-schema-error`
  return (
    <form
      method="post"
      action={props.action}
      // Once hydrated the fields show the schema's messages; before that, only the browser's own checks run.
      noValidate={hydrated}
      className="grid gap-3"
      aria-busy={props.pending}
      aria-describedby={describedBy(props.error && errorId, schemaError && schemaErrorId)}
      onSubmit={(event) => {
        event.preventDefault()
        if (props.pending) return
        submit(event.currentTarget)
      }}
      {...(props.schema ? loadOnInteraction(props.schema) : {})}
    >
      {props.children}
      <div>
        <Button
          type="submit"
          variant={props.submitVariant}
          disabled={!hydrated && props.action === undefined}
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
      <FieldError id={schemaErrorId} message={schemaError} />
    </form>
  )
}
