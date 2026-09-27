import { useHydrated } from '@tanstack/react-router'
import { type ReactNode, useEffect, useRef } from 'react'
import { describedBy, focusFirstInvalid } from '#/components/form/field-messages.ts'
import { FieldError } from '#/components/form/fields.tsx'
import { loadOnInteraction, useSchemaSubmit } from '#/components/form/lazy-schema.ts'
import { ServerIssues } from '#/components/form/server-issues.ts'
import { Button } from '#/components/ui/button.tsx'
import {
  type AuthFieldCodes,
  authFieldIssues,
  describeAuthFailure,
} from '#/features/auth/utils/describe-auth-failure.ts'

/**
 * The server's failure, split: the part about one field goes next to that field, which then takes focus so the
 * user can fix it; anything else is the form's alert.
 */
function useFailure(error: Error | null, fieldCodes: AuthFieldCodes = {}) {
  const form = useRef<HTMLFormElement>(null)
  const issues = authFieldIssues(error, fieldCodes)
  const onField = Object.keys(issues).length > 0
  // Again for every failed attempt (a new `error`), even when it is the same field as the last time.
  useEffect(() => {
    if (error !== null && onField && form.current) focusFirstInvalid(form.current)
  }, [error, onField])
  return { form, issues, formError: onField ? null : error }
}

/**
 * The shell of an account form made with useAppForm: its fields are the children, validated in the browser with
 * the action's Effect Schema (src/lib/account-input.ts), loaded on the first interaction (lazyFormSchema); a failed
 * submit moves focus to the first invalid field.
 * Without an `action` the button stays disabled until hydration: a native submit before that would post the fields
 * (passwords included) to the page itself. While the action is pending the button is only `aria-disabled` and further submits
 * are ignored: a disabled button loses focus, so a keyboard user who pressed it would be dropped to <body> when the
 * attempt fails. A failure the server reports, or a schema that could not be loaded, is shown in an alert under
 * the button, unless `fieldCodes` pins it on a field.
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
  /** The failure codes this form shows next to a field, and which (a wrong password: `{ INVALID_PASSWORD: 'password' }`). */
  fieldCodes?: AuthFieldCodes
  children?: ReactNode
}) {
  const hydrated = useHydrated()
  const { submit, schemaError } = useSchemaSubmit(props.form, props.schema)
  const { form, issues, formError } = useFailure(props.error, props.fieldCodes)
  const errorId = `${props.id}-error`
  const schemaErrorId = `${props.id}-schema-error`
  return (
    <form
      ref={form}
      method="post"
      action={props.action}
      // Once hydrated the fields show the schema's messages; before that, only the browser's own checks run.
      noValidate={hydrated}
      className="grid gap-3"
      aria-busy={props.pending}
      aria-describedby={describedBy(formError && errorId, schemaError && schemaErrorId)}
      onSubmit={(event) => {
        event.preventDefault()
        if (props.pending) return
        submit(event.currentTarget)
      }}
      {...(props.schema ? loadOnInteraction(props.schema) : {})}
    >
      <ServerIssues value={issues}>{props.children}</ServerIssues>
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
      {formError ? (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {describeAuthFailure(formError)}
        </p>
      ) : null}
      <FieldError id={schemaErrorId} message={schemaError} />
    </form>
  )
}
