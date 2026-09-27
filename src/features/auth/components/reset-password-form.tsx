import { revalidateLogic } from '@tanstack/react-form'
import { Link } from '@tanstack/react-router'
import { useAppForm } from '#/components/form/app-form.ts'
import { lazyFormSchema } from '#/components/form/lazy-schema.ts'
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '#/contract/limits.ts'
import { useResetPassword } from '#/features/auth/api/reset-password.ts'
import { AuthForm } from '#/features/auth/components/auth-form.tsx'
import { AuthStatus } from '#/features/auth/components/auth-status.tsx'

const schema = lazyFormSchema(() => import('#/lib/account-input.ts').then((module) => module.NewPasswordInput))

/** Sets a new password with the token from a reset link. Every session of the account ends. */
export function ResetPasswordForm(props: { token: string }) {
  const reset = useResetPassword()
  const form = useAppForm({
    defaultValues: { newPassword: '' },
    validationLogic: revalidateLogic(),
    validators: { onDynamic: schema.validator },
    onSubmit: ({ value }) => reset.mutate({ token: props.token, ...schema.decode(value) }),
  })
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
      form={form}
      schema={schema}
      pending={reset.isPending}
      error={reset.error}
    >
      <form.AppField name="newPassword">
        {(field) => (
          <field.TextField
            id="new-password"
            label="New password"
            type="password"
            autoComplete="new-password"
            minLength={PASSWORD_MIN_LENGTH}
            maxLength={PASSWORD_MAX_LENGTH}
            hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
            required
          />
        )}
      </form.AppField>
    </AuthForm>
  )
}
