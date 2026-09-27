import { createFormHook } from '@tanstack/react-form'
import { CheckboxField, TextField } from './fields.tsx'
import { fieldContext, formContext } from './form-context.ts'

/**
 * TanStack Form with the app's field components (`<form.AppField name="email">{(field) => <field.TextField … />}`).
 * Forms validate with an Effect Schema through Standard Schema as `validators.onDynamic`, with
 * `validationLogic: revalidateLogic()`: nothing is flagged while the user first types, every field on submit, and
 * a flagged field again on each change until it is fixed.
 */
export const { useAppForm } = createFormHook({
  fieldContext,
  formContext,
  fieldComponents: { TextField, CheckboxField },
  formComponents: {},
})
