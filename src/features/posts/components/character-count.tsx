import { POST_MAX_LENGTH } from '#/contract/limits.ts'
import { cn } from '#/lib/utils.ts'

/** The API rejects untrimmed bodies, so the forms send `body.trim()`; the limit applies to that. */
export const isTooLong = (value: string) => value.trim().length > POST_MAX_LENGTH

/**
 * "123/280" counter, referenced by the textarea's aria-describedby. The count itself is not a live region
 * (that would announce every keystroke); only crossing the limit is announced.
 */
export function CharacterCount(props: { id: string; value: string }) {
  const tooLong = isTooLong(props.value)
  return (
    <span id={props.id} className={cn('text-sm tabular-nums', tooLong ? 'text-destructive' : 'text-muted-foreground')}>
      {props.value.trim().length}/{POST_MAX_LENGTH}
      <span className="sr-only"> characters. </span>
      <span className="sr-only" aria-live="polite">
        {tooLong ? `Over the ${POST_MAX_LENGTH}-character limit.` : ''}
      </span>
    </span>
  )
}
