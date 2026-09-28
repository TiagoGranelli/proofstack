/** A field's error, announced when it appears (after a submit, or while fixing a field that failed one). */
export function FieldError(props: { id: string; message: string | undefined }) {
  if (!props.message) return null
  return (
    <p id={props.id} role="alert" className="text-sm text-destructive">
      {props.message}
    </p>
  )
}
