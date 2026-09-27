import { useState } from 'react'
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '#/contract/limits.ts'
import { useChangePassword } from '#/features/auth/api/change-password.ts'
import { AuthField, AuthForm } from '#/features/auth/components/auth-form.tsx'
import { AuthStatus } from '#/features/auth/components/auth-status.tsx'
import { formText } from '#/features/auth/utils/form-text.ts'

/** Changes the password. Every other session of the account is signed out; this one continues. */
export function ChangePasswordForm() {
  // Bumped on success: a fresh form, so the password fields are empty again.
  const [generation, setGeneration] = useState(0)
  const change = useChangePassword({ mutationConfig: { onSuccess: () => setGeneration((value) => value + 1) } })
  return (
    <div className="grid gap-3">
      <AuthForm
        key={generation}
        id="change-password"
        submitLabel="Change password"
        pending={change.isPending}
        error={change.error}
        onSubmit={(form) =>
          change.mutate({
            currentPassword: formText(form, 'current-password'),
            newPassword: formText(form, 'new-password'),
          })
        }
      >
        <AuthField
          id="current-password"
          name="current-password"
          label="Current password"
          type="password"
          autoComplete="current-password"
          required
        />
        <AuthField
          id="new-password"
          name="new-password"
          label="New password"
          type="password"
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          maxLength={PASSWORD_MAX_LENGTH}
          hint={`At least ${PASSWORD_MIN_LENGTH} characters. Your other sessions will be signed out.`}
          required
        />
      </AuthForm>
      {/* The fresh form has no focus, so the message takes it. */}
      {change.isSuccess ? (
        <AuthStatus title="Password changed" headingLevel={3}>
          Your other sessions were signed out.
        </AuthStatus>
      ) : null}
    </div>
  )
}
