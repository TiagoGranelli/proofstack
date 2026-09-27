import { useSuspenseQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Button } from '#/components/ui/button.tsx'
import { AuthActionError } from '#/features/auth/api/auth-action.ts'
import { getSessionsQueryOptions } from '#/features/auth/api/get-sessions.ts'
import { useRevokeOtherSessions } from '#/features/auth/api/revoke-other-sessions.ts'
import { useRevokeSession } from '#/features/auth/api/revoke-session.ts'
import { useSignOutEverywhere } from '#/features/auth/api/sign-out-everywhere.ts'
import { useSignOutMutation } from '#/features/auth/api/sign-out.ts'
import { describeAuthFailure } from '#/features/auth/utils/describe-auth-failure.ts'
import { describeDevice, formatTimestamp } from '#/features/auth/utils/describe-session.ts'
import type { SessionView } from '#/lib/auth.functions.ts'

const alert = 'text-sm text-destructive'

/** Better Auth lists sessions only for a recent sign-in: sign out, then back in, and return here. */
function SignInAgain() {
  const navigate = useNavigate()
  const signOut = useSignOutMutation({
    mutationConfig: { onSuccess: () => navigate({ to: '/login', search: { redirect: '/account' } }) },
  })
  return (
    <div className="grid gap-2">
      <p>{describeAuthFailure(new AuthActionError({ code: 'SESSION_NOT_FRESH' }))}</p>
      <div>
        <Button type="button" variant="outline" disabled={signOut.isPending} onClick={() => signOut.mutate()}>
          Sign in again
        </Button>
      </div>
      {signOut.isError ? (
        <p role="alert" className={alert}>
          {describeAuthFailure(signOut.error)}
        </p>
      ) : null}
    </div>
  )
}

function SessionItem(props: { session: SessionView }) {
  const { session } = props
  const revoke = useRevokeSession()
  const device = describeDevice(session.userAgent)
  return (
    <li className="flex flex-wrap items-start justify-between gap-2 border-b py-3 last:border-b-0">
      <div className="grid gap-0.5 text-sm">
        <p className="font-medium">
          {device}
          {session.current ? <span className="ml-2 text-muted-foreground">(this browser)</span> : null}
        </p>
        <p className="text-muted-foreground">
          {session.ipAddress ? `${session.ipAddress} · ` : ''}signed in {formatTimestamp(session.createdAt)}, last
          active {formatTimestamp(session.lastActiveAt)}
        </p>
        {revoke.isError ? (
          <p role="alert" className={alert}>
            {describeAuthFailure(revoke.error)}
          </p>
        ) : null}
      </div>
      {session.current ? null : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={revoke.isPending}
          aria-busy={revoke.isPending}
          aria-label={`Sign out ${device}, signed in ${formatTimestamp(session.createdAt)}`}
          onClick={() => revoke.mutate({ id: session.id })}
        >
          Sign out
        </Button>
      )}
    </li>
  )
}

/** The account's sessions, each one revocable, plus "sign out other sessions" and "sign out everywhere". */
export function SessionList() {
  const navigate = useNavigate()
  const { data: sessions } = useSuspenseQuery(getSessionsQueryOptions())
  const others = useRevokeOtherSessions()
  const everywhere = useSignOutEverywhere({ mutationConfig: { onSuccess: () => navigate({ to: '/login' }) } })

  if (!sessions.ok)
    return sessions.failure.code === 'SESSION_NOT_FRESH' ? (
      <SignInAgain />
    ) : (
      <p role="alert" className={alert}>
        {describeAuthFailure(new AuthActionError(sessions.failure))}
      </p>
    )

  const hasOthers = sessions.value.some((session) => !session.current)
  return (
    <div className="grid gap-3">
      <ul aria-label="Active sessions" data-testid="sessions">
        {sessions.value.map((session) => (
          <SessionItem key={session.id} session={session} />
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={!hasOthers || others.isPending}
          aria-busy={others.isPending}
          onClick={() => others.mutate()}
        >
          Sign out other sessions
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={everywhere.isPending}
          aria-busy={everywhere.isPending}
          onClick={() => everywhere.mutate()}
        >
          Sign out everywhere
        </Button>
      </div>
      {others.isError || everywhere.isError ? (
        <p role="alert" className={alert}>
          {describeAuthFailure(others.error ?? everywhere.error)}
        </p>
      ) : null}
    </div>
  )
}
