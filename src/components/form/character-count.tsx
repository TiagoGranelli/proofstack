import { cn } from '#/lib/utils.ts'

/** The API rejects untrimmed text, so the forms send `value.trim()`; the limit applies to that. */
export const isTooLong = (value: string, max: number) => value.trim().length > max

/**
 * "123/280" counter of a text field with a length limit, referenced by the field's aria-describedby. The count
 * itself is not a live region (that would announce every keystroke); only crossing the limit is announced.
 */
export function CharacterCount(props: { id: string; value: string; max: number }) {
  const tooLong = isTooLong(props.value, props.max)
  return (
    <span id={props.id} className={cn('text-sm tabular-nums', tooLong ? 'text-destructive' : 'text-muted-foreground')}>
      {props.value.trim().length}/{props.max}
      <span className="sr-only"> characters. </span>
      <span className="sr-only" aria-live="polite">
        {tooLong ? `Over the ${props.max}-character limit.` : ''}
      </span>
    </span>
  )
}
