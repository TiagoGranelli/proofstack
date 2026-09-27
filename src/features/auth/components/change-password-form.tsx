import { revalidateLogic } from '@tanstack/react-form'
import { Schema } from 'effect'
import { useAppForm } from '#/components/form/app-form.ts'
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '#/contract/limits.ts'
import { useChangePassword } from '#/features/auth/api/change-password.ts'
import { AuthForm } from '#/features/auth/components/auth-form.tsx'
import { AuthStatus } from '#/features/auth/components/auth-status.tsx'
import { ChangePasswordInput } from '#/lib/account-input.ts'

const validator = Schema.toStandardSchemaV1(ChangePasswordInput)
const decode = Schema.decodeSync(ChangePasswordInput)

/** Changes the password. Every other session of the account is signed out; this one continues. */
export function ChangePasswordForm() {
  const change = useChangePassword({ mutationConfig: { onSuccess: () => form.reset() } })
  const form = useAppForm({
    defaultValues: { currentPassword: '', newPassword: '' },
    validationLogic: revalidateLogic(),
    validators: { onDynamic: validator },
    onSubmit: ({ value }) => change.mutate(decode(value)),
  })
  return (
    <div className="grid gap-3">
      <AuthForm
        id="change-password"
        submitLabel="Change password"
        form={form}
        pending={change.isPending}
        error={change.error}
      >
        <form.AppField name="currentPassword">
          {(field) => (
            <field.TextField
              id="current-password"
              label="Current password"
              type="password"
              autoComplete="current-password"
              required
            />
          )}
        </form.AppField>
        <form.AppField name="newPassword">
          {(field) => (
            <field.TextField
              id="new-password"
              label="New password"
              type="password"
              autoComplete="new-password"
              minLength={PASSWORD_MIN_LENGTH}
              maxLength={PASSWORD_MAX_LENGTH}
              hint={`At least ${PASSWORD_MIN_LENGTH} characters. Your other sessions will be signed out.`}
              required
            />
          )}
        </form.AppField>
      </AuthForm>
      {/* The emptied form keeps no focus of its own, so the message takes it. */}
      {change.isSuccess ? (
        <AuthStatus title="Password changed" headingLevel={3}>
          Your other sessions were signed out.
        </AuthStatus>
      ) : null}
    </div>
  )
}
