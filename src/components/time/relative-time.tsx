import { useSyncExternalStore } from 'react'
import { describeTime } from '#/components/time/describe-time.ts'
import { readMinuteClock, subscribeToMinuteClock } from '#/components/time/minute-clock.ts'

// The server has no visitor's clock or time zone: SSR and hydration render the UTC date, the browser its own right after.
const noClockOnServer = () => null

/** When something was written: relative and local in the browser, with the exact time in `datetime` and on hover. */
export function RelativeTime(props: { iso: string }) {
  const now = useSyncExternalStore(subscribeToMinuteClock, readMinuteClock, noClockOnServer)
  const { label, title } = describeTime(props.iso, now === null ? null : { now })
  return (
    <time dateTime={props.iso} title={title}>
      {label}
    </time>
  )
}
