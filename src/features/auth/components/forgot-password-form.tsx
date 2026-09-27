import { revalidateLogic } from '@tanstack/react-form'
import { Schema } from 'effect'
import { useAppForm } from '#/components/form/app-form.ts'
import { useRequestPasswordReset } from '#/features/auth/api/request-password-reset.ts'
import { AuthForm } from '#/features/auth/components/auth-form.tsx'
import { AuthStatus } from '#/features/auth/components/auth-status.tsx'
import { EmailInput } from '#/lib/account-input.ts'

const validator = Schema.toStandardSchemaV1(EmailInput)
const decode = Schema.decodeSync(EmailInput)

/** Asks for a reset link. The answer does not reveal whether the address has an account. */
export function ForgotPasswordForm() {
  const request = useRequestPasswordReset()
  const form = useAppForm({
    defaultValues: { email: '' },
    validationLogic: revalidateLogic(),
    validators: { onDynamic: validator },
    onSubmit: ({ value }) => request.mutate(decode(value)),
  })
  if (request.isSuccess)
    return (
      <AuthStatus title="Check your inbox">
        If <strong>{request.variables.email}</strong> belongs to an account, we sent it a link to choose a new password.
        The link works for one hour.
      </AuthStatus>
    )
  return (
    <AuthForm
      id="forgot-password"
      submitLabel="Send reset link"
      form={form}
      pending={request.isPending}
      error={request.error}
    >
      <form.AppField name="email">
        {(field) => <field.TextField id="email" label="Email" type="email" autoComplete="email" required />}
      </form.AppField>
    </AuthForm>
  )
}
