import { Link } from '@tanstack/react-router'
import { useAppForm } from '#/components/form/app-form.ts'
import { useVerifyEmail } from '#/features/auth/api/verify-email.ts'
import { AuthForm } from '#/features/auth/components/auth-form.tsx'
import { AuthStatus } from '#/features/auth/components/auth-status.tsx'
import { ResendVerificationForm } from '#/features/auth/components/resend-verification-form.tsx'

/**
 * Confirms the address of a confirmation link, but only when its owner presses the button: opening the link
 * (a GET, which mail scanners and link previews also make) changes nothing. Signing in stays a separate step.
 */
export function VerifyEmailForm(props: { token: string }) {
  const verify = useVerifyEmail()
  // No fields: the token comes from the link.
  const form = useAppForm({ defaultValues: {}, onSubmit: () => verify.mutate({ token: props.token }) })
  if (verify.isSuccess)
    return (
      <AuthStatus title="Email confirmed">
        Your email address is confirmed.{' '}
        <Link to="/login" className="underline underline-offset-4">
          Sign in
        </Link>{' '}
        to continue.
      </AuthStatus>
    )
  return (
    <>
      <AuthForm
        id="verify-email"
        submitLabel="Confirm email"
        form={form}
        pending={verify.isPending}
        error={verify.error}
      >
        <p>Confirm that this address is yours to finish setting up your account.</p>
      </AuthForm>
      {verify.isError ? <ResendVerificationForm /> : null}
    </>
  )
}
