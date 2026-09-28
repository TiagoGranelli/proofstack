import { revalidateLogic } from '@tanstack/react-form'
import { useNavigate } from '@tanstack/react-router'
import { useAppForm } from '#/components/form/app-form.ts'
import { lazyFormSchema } from '#/components/form/lazy-schema.ts'
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '#/contract/limits.ts'
import { useResetPassword } from '#/features/auth/api/reset-password.ts'
import { AuthForm } from '#/features/auth/components/auth-form.tsx'

const schema = lazyFormSchema(() => import('#/lib/account-input.ts').then((module) => module.NewPasswordInput))

/**
 * Sets a new password with the token from a reset link. Every session of the account ends, so the next step is
 * signing in: the form goes to /login, which says why (a flash message).
 */
export function ResetPasswordForm(props: { token: string }) {
  const navigate = useNavigate()
  const reset = useResetPassword({
    mutationConfig: { onSuccess: () => navigate({ to: '/login', state: { flash: 'password-reset' } }) },
  })
  const form = useAppForm({
    defaultValues: { newPassword: '' },
    validationLogic: revalidateLogic(),
    validators: { onDynamic: schema.validator },
    onSubmit: ({ value }) => reset.mutate({ token: props.token, ...schema.decode(value) }),
  })
  return (
    <AuthForm
      id="reset-password"
      submitLabel="Set new password"
      form={form}
      schema={schema}
      pending={reset.isPending}
      error={reset.error}
      fieldCodes={{ PASSWORD_TOO_SHORT: 'newPassword', PASSWORD_TOO_LONG: 'newPassword' }}
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
