import { revalidateLogic } from '@tanstack/react-form'
import { useNavigate } from '@tanstack/react-router'
import { Schema } from 'effect'
import { useAppForm } from '#/components/form/app-form.ts'
import { useDeleteAccount } from '#/features/auth/api/delete-account.ts'
import { AuthForm } from '#/features/auth/components/auth-form.tsx'
import { DeleteAccountFields } from '#/lib/account-input.ts'

const validator = Schema.toStandardSchemaV1(DeleteAccountFields)

/**
 * Deletes the account and its posts. Two confirmations: the password (checked by Better Auth) and an explicit
 * checkbox, so neither a stray click nor an unattended signed-in browser is enough.
 */
export function DeleteAccountForm() {
  const navigate = useNavigate()
  const remove = useDeleteAccount({ mutationConfig: { onSuccess: () => navigate({ to: '/', replace: true }) } })
  const form = useAppForm({
    defaultValues: { password: '', confirm: false },
    validationLogic: revalidateLogic(),
    validators: { onDynamic: validator },
    onSubmit: ({ value }) => remove.mutate({ password: value.password }),
  })
  return (
    <AuthForm
      id="delete-account"
      submitLabel="Delete account"
      submitVariant="destructive"
      form={form}
      pending={remove.isPending}
      error={remove.error}
    >
      <form.AppField name="password">
        {(field) => (
          <field.TextField
            id="delete-password"
            label="Password"
            type="password"
            autoComplete="current-password"
            required
          />
        )}
      </form.AppField>
      <form.AppField name="confirm">
        {(field) => (
          <field.CheckboxField
            id="delete-confirm"
            label="I understand that my account and all my posts are deleted for good."
            className="mt-0.5 size-4 accent-destructive"
            required
          />
        )}
      </form.AppField>
    </AuthForm>
  )
}
