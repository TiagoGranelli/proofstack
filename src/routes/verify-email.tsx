import { Link, createFileRoute } from '@tanstack/react-router'
import { AuthActionError } from '#/features/auth/api/auth-action.ts'
import { ResendVerificationForm } from '#/features/auth/components/resend-verification-form.tsx'
import { describeAuthFailure } from '#/features/auth/utils/describe-auth-failure.ts'
import { verifyEmail } from '#/lib/auth.functions.ts'

// Opened from the confirmation email (src/server/mail/auth-messages.ts). Opening the link is the confirmation,
// as with Better Auth's own GET /verify-email; it creates no session, signing in stays a separate step.
export const Route = createFileRoute('/verify-email')({
  validateSearch: (search: Record<string, unknown>): { token?: string } =>
    typeof search.token === 'string' && search.token ? { token: search.token } : {},
  loaderDeps: ({ search }) => ({ token: search.token }),
  loader: ({ deps }) => (deps.token ? verifyEmail({ data: { token: deps.token } }) : null),
  head: () => ({ meta: [{ title: 'Confirm your email · ProofStack' }, { name: 'robots', content: 'noindex' }] }),
  headers: () => ({ 'cache-control': 'private, no-store' }),
  component: VerifyEmail,
})

function VerifyEmail() {
  const outcome = Route.useLoaderData()
  return (
    <main className="mx-auto grid max-w-sm gap-4 p-4">
      <h1 className="text-2xl font-semibold">Confirm your email</h1>
      {outcome?.ok ? (
        <output className="block">
          Your email address is confirmed.{' '}
          <Link to="/login" className="underline underline-offset-4">
            Sign in
          </Link>{' '}
          to continue.
        </output>
      ) : (
        <>
          {outcome ? (
            <p role="alert" className="text-destructive">
              {describeAuthFailure(new AuthActionError(outcome.failure))}
            </p>
          ) : (
            <p>Open the link in the email we sent you. Did not get it? Ask for a new one.</p>
          )}
          <ResendVerificationForm />
        </>
      )}
    </main>
  )
}
