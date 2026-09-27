import { revalidateLogic } from '@tanstack/react-form'
import { Schema } from 'effect'
import { useAppForm } from '#/components/form/app-form.ts'
import { useResendVerification } from '#/features/auth/api/resend-verification.ts'
import { AuthForm } from '#/features/auth/components/auth-form.tsx'
import { AuthStatus } from '#/features/auth/components/auth-status.tsx'
import { EmailInput } from '#/lib/account-input.ts'

const validator = Schema.toStandardSchemaV1(EmailInput)
const decode = Schema.decodeSync(EmailInput)

/** Asks for a new confirmation link. The answer does not reveal whether the address has an account. */
export function ResendVerificationForm() {
  const resend = useResendVerification()
  const form = useAppForm({
    defaultValues: { email: '' },
    validationLogic: revalidateLogic(),
    validators: { onDynamic: validator },
    onSubmit: ({ value }) => resend.mutate(decode(value)),
  })
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
      form={form}
      pending={resend.isPending}
      error={resend.error}
    >
      <form.AppField name="email">
        {(field) => <field.TextField id="email" label="Email" type="email" autoComplete="email" required />}
      </form.AppField>
    </AuthForm>
  )
}
