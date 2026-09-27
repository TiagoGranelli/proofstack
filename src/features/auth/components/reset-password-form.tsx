import { Link } from '@tanstack/react-router'
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '#/contract/limits.ts'
import { useResetPassword } from '#/features/auth/api/reset-password.ts'
import { AuthField, AuthForm } from '#/features/auth/components/auth-form.tsx'
import { AuthStatus } from '#/features/auth/components/auth-status.tsx'
import { formText } from '#/features/auth/utils/form-text.ts'

/** Sets a new password with the token from a reset link. Every session of the account ends. */
export function ResetPasswordForm(props: { token: string }) {
  const reset = useResetPassword()
  if (reset.isSuccess)
    return (
      <AuthStatus title="Password changed">
        Your password is changed, and every session of your account was signed out.{' '}
        <Link to="/login" className="underline underline-offset-4">
          Sign in
        </Link>{' '}
        with the new password.
      </AuthStatus>
    )
  return (
    <AuthForm
      id="reset-password"
      submitLabel="Set new password"
      pending={reset.isPending}
      error={reset.error}
      onSubmit={(form) => reset.mutate({ token: props.token, newPassword: formText(form, 'new-password') })}
    >
      <AuthField
        id="new-password"
        name="new-password"
        label="New password"
        type="password"
        autoComplete="new-password"
        minLength={PASSWORD_MIN_LENGTH}
        maxLength={PASSWORD_MAX_LENGTH}
        hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
        required
      />
    </AuthForm>
  )
}
