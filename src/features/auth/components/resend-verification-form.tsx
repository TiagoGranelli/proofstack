import { useResendVerification } from '#/features/auth/api/resend-verification.ts'
import { AuthField, AuthForm } from '#/features/auth/components/auth-form.tsx'
import { AuthStatus } from '#/features/auth/components/auth-status.tsx'
import { formText } from '#/features/auth/utils/form-text.ts'

/** Asks for a new confirmation link. The answer does not reveal whether the address has an account. */
export function ResendVerificationForm() {
  const resend = useResendVerification()
  if (resend.isSuccess)
    return (
      <AuthStatus title="Check your inbox">
        If <strong>{resend.variables.email}</strong> has an account waiting for confirmation, we sent it a new link.
      </AuthStatus>
    )
  return (
    <AuthForm
      id="resend-verification"
      submitLabel="Send a new link"
      pending={resend.isPending}
      error={resend.error}
      onSubmit={(form) => resend.mutate({ email: formText(form, 'email').trim() })}
    >
      <AuthField id="email" name="email" label="Email" type="email" autoComplete="email" required />
    </AuthForm>
  )
}
