import { type ComponentProps, type ReactNode, use } from 'react'
import { Input } from '#/components/ui/input.tsx'
import { Label } from '#/components/ui/label.tsx'
import { FieldError } from './field-error.tsx'
import { describedBy, fieldErrorMessage } from './field-messages.ts'
import { useFieldContext } from './form-context.ts'
import { ServerIssues } from './server-issues.ts'

type InputProps = Omit<ComponentProps<'input'>, 'name' | 'value' | 'checked' | 'onChange' | 'onBlur'>

/**
 * A labelled input bound to its form field. The hint and the field's error, its own or one the server reported
 * for it (ServerIssues), are read out with it.
 */
export function TextField({ label, hint, id, ...input }: InputProps & { id: string; label: string; hint?: string }) {
  const field = useFieldContext<string>()
  const serverIssue = use(ServerIssues)[field.name]
  const error = fieldErrorMessage(field.state.meta.errors) ?? serverIssue
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = `${id}-error`
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        {...input}
        id={id}
        name={field.name}
        value={field.state.value}
        onChange={(event) => field.handleChange(event.target.value)}
        onBlur={field.handleBlur}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(hintId, error && errorId)}
      />
      {hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      <FieldError id={errorId} message={error} />
    </div>
  )
}

/** A checkbox bound to its form field, with its label after it. */
export function CheckboxField({ label, id, ...input }: InputProps & { id: string; label: ReactNode }) {
  const field = useFieldContext<boolean>()
  const error = fieldErrorMessage(field.state.meta.errors)
  const errorId = `${id}-error`
  return (
    <div className="grid gap-1.5">
      <div className="flex items-start gap-2 text-sm">
        <input
          {...input}
          id={id}
          name={field.name}
          type="checkbox"
          checked={field.state.value}
          onChange={(event) => field.handleChange(event.target.checked)}
          onBlur={field.handleBlur}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(error && errorId)}
        />
        <label htmlFor={id}>{label}</label>
      </div>
      <FieldError id={errorId} message={error} />
    </div>
  )
}
