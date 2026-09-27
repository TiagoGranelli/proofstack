import { useNavigate } from '@tanstack/react-router'
import { useDeleteAccount } from '#/features/auth/api/delete-account.ts'
import { AuthField, AuthForm } from '#/features/auth/components/auth-form.tsx'
import { formText } from '#/features/auth/utils/form-text.ts'

/**
 * Deletes the account and its posts. Two confirmations: the password (checked by Better Auth) and an explicit
 * checkbox, so neither a stray click nor an unattended signed-in browser is enough.
 */
export function DeleteAccountForm() {
  const navigate = useNavigate()
  const remove = useDeleteAccount({ mutationConfig: { onSuccess: () => navigate({ to: '/', replace: true }) } })
  return (
    <AuthForm
      id="delete-account"
      submitLabel="Delete account"
      submitVariant="destructive"
      pending={remove.isPending}
      error={remove.error}
      onSubmit={(form) => remove.mutate({ password: formText(form, 'delete-password') })}
    >
      <AuthField
        id="delete-password"
        name="delete-password"
        label="Password"
        type="password"
        autoComplete="current-password"
        required
      />
      <div className="flex items-start gap-2 text-sm">
        <input
          id="delete-confirm"
          name="delete-confirm"
          type="checkbox"
          required
          className="mt-0.5 size-4 accent-destructive"
        />
        <label htmlFor="delete-confirm">I understand that my account and all my posts are deleted for good.</label>
      </div>
    </AuthForm>
  )
}
