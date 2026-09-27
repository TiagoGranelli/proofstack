/** A text field of a submitted form ('' when absent or a file). */
export function formText(form: FormData, name: string): string {
  const value = form.get(name)
  return typeof value === 'string' ? value : ''
}
