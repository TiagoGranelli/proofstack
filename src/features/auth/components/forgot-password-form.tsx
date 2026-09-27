import { useRequestPasswordReset } from '#/features/auth/api/request-password-reset.ts'
import { AuthField, AuthForm } from '#/features/auth/components/auth-form.tsx'
import { formText } from '#/features/auth/utils/form-text.ts'

/** Asks for a reset link. The answer does not reveal whether the address has an account. */
export function ForgotPasswordForm() {
  const request = useRequestPasswordReset()
  if (request.isSuccess)
    return (
      <output className="block">
        If <strong>{request.variables.email}</strong> belongs to an account, we sent it a link to choose a new password.
        The link works for one hour.
      </output>
    )
  return (
    <AuthForm
      id="forgot-password"
      submitLabel="Send reset link"
      pending={request.isPending}
      error={request.error}
      onSubmit={(form) => request.mutate({ email: formText(form, 'email').trim() })}
    >
      <AuthField id="email" name="email" label="Email" type="email" autoComplete="email" required />
    </AuthForm>
  )
}
