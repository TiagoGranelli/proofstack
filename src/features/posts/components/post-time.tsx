import { useSyncExternalStore } from 'react'
import { readMinuteClock, subscribeToMinuteClock } from '#/features/posts/utils/minute-clock.ts'
import { describePostTime } from '#/features/posts/utils/post-time.ts'

// The server has no visitor's clock or time zone: SSR and hydration render the UTC date, the browser its own right after.
const noClockOnServer = () => null

/** When a post was written: relative and local in the browser, with the exact time in `datetime` and on hover. */
export function PostTime(props: { iso: string }) {
  const now = useSyncExternalStore(subscribeToMinuteClock, readMinuteClock, noClockOnServer)
  const { label, title } = describePostTime(props.iso, now === null ? null : { now })
  return (
    <time dateTime={props.iso} title={title}>
      {label}
    </time>
  )
}
