/**
 * The first error message of a TanStack Form field. Its validators leave Standard Schema issues (`{ message }`) or
 * strings in `meta.errors`, with `undefined` for a validator that passed.
 */
export function fieldErrorMessage(errors: ReadonlyArray<unknown>): string | undefined {
  for (const error of errors) {
    if (typeof error === 'string' && error) return error
    if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string')
      return error.message
  }
  return undefined
}

/** An `aria-describedby` value from the ids that apply, or undefined when none does. */
export const describedBy = (...ids: ReadonlyArray<string | false | null | undefined>) =>
  ids.filter((id) => typeof id === 'string' && id !== '').join(' ') || undefined

/**
 * After a submit, moves focus to the first field the form marked invalid, so a keyboard or screen reader user lands
 * on the problem and hears its message. Waits a frame: the invalid state renders after the submit handler returns.
 */
export const focusFirstInvalid = (form: HTMLFormElement) =>
  requestAnimationFrame(() => form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
