import { Link, useLocation } from '@tanstack/react-router'
import { describeApiError } from '#/lib/api-error.ts'

/** Announces a failed API call. `action` completes "Could not …", e.g. "save your changes". */
export function ApiErrorAlert(props: { error: unknown; action: string; id?: string }) {
  const href = useLocation({ select: (location) => location.href })
  const { message, signIn } = describeApiError(props.error, props.action)
  return (
    <p id={props.id} role="alert" className="text-sm text-destructive">
      {message}
      {signIn ? (
        <>
          {' '}
          <Link to="/login" search={{ redirect: href }} className="font-medium underline underline-offset-4">
            Sign in
          </Link>
        </>
      ) : null}
    </p>
  )
}
