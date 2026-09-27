import type { StandardSchemaV1 } from '@tanstack/react-form'
import type { Schema } from 'effect'
import { focusFirstInvalid } from './field-messages.ts'

type FormSchema<Fields, Output> = {
  validator: StandardSchemaV1<Fields, Output>
  decode: (fields: Fields) => Output
}

/**
 * A form's Effect Schema, loaded on the first interaction instead of with the page. The Schema runtime is about
 * 40 KB gzip, and preloading it kept the form pages' mobile Lighthouse score under 100. Nothing validates before
 * the first submit (`revalidateLogic()`), and `submitForm` awaits `load` first, so the schema is always there
 * when TanStack Form asks.
 */
export type LazyFormSchema<Fields, Output> = {
  /** For `validators.onDynamic`. Throws if it runs before `load` resolved: submit through `submitForm`. */
  readonly validator: StandardSchemaV1<Fields, Output>
  /** The valid fields as the action takes them (for example, trimmed). Same rule as `validator`. */
  readonly decode: (fields: Fields) => Output
  /** Starts loading the schema, once; resolves when it is ready. A failed load is retried on the next call. */
  readonly load: () => Promise<void>
}

/**
 * Wraps `loadSchema`, a dynamic import that resolves to the form's schema (the same one the server validates
 * with), for example `() => import('#/lib/account-input.ts').then((m) => m.SignInInput)`.
 */
export const lazyFormSchema = <S extends Schema.ConstraintDecoder<unknown>>(
  loadSchema: () => Promise<S>,
): LazyFormSchema<S['Encoded'], S['Type']> => {
  let loaded: FormSchema<S['Encoded'], S['Type']> | undefined
  let loading: Promise<void> | undefined
  const ready = () => {
    if (loaded) return loaded
    throw new Error('a form schema was used before it loaded: submit through submitForm, which awaits it')
  }
  const loadOnce = async () => {
    const [schema, toFormSchema] = await Promise.all([
      loadSchema(),
      import('./form-schema.ts').then((module) => module.toFormSchema),
    ])
    loaded = toFormSchema(schema)
  }
  const load = () =>
    (loading ??= loadOnce().catch((error: unknown) => {
      loading = undefined
      throw error
    }))
  return {
    validator: {
      '~standard': {
        version: 1,
        vendor: 'effect',
        validate: (value) => ready().validator['~standard'].validate(value),
      },
    },
    decode: (fields) => ready().decode(fields),
    load,
  }
}

const startLoading = (schema: { load: () => Promise<void> }) => () => {
  // A failed load here is only an early start; the submit loads again and reports its own failure.
  schema.load().catch(() => {})
}

/** Props for the `<form>`: its first focus or input starts loading `schema`. */
export const loadOnInteraction = (schema: { load: () => Promise<void> }) => ({
  onFocus: startLoading(schema),
  onInput: startLoading(schema),
})

/**
 * Submits a TanStack form once its schema has loaded (a submit may come before the chunk arrives), then moves
 * focus to the first field the form marked invalid.
 */
export const submitForm = async (
  element: HTMLFormElement,
  form: { handleSubmit: () => Promise<void> },
  schema?: { load: () => Promise<void> },
) => {
  await schema?.load()
  await form.handleSubmit()
  focusFirstInvalid(element)
}
