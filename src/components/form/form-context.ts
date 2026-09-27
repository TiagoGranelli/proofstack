import { createFormHookContexts } from '@tanstack/react-form'

// The contexts that connect a form made with useAppForm (./app-form.ts) to its field components.
export const { fieldContext, formContext, useFieldContext } = createFormHookContexts()
