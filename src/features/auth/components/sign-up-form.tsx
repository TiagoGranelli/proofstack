import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '#/contract/limits.ts'
import { useSignUp } from '#/features/auth/api/sign-up.ts'
import { AuthField, AuthForm } from '#/features/auth/components/auth-form.tsx'
import { AuthStatus } from '#/features/auth/components/auth-status.tsx'
import { formText } from '#/features/auth/utils/form-text.ts'

/**
 * Creates an account. The answer is the same whether or not the address already has one (no enumeration):
 * either way the next step is in the inbox.
 */
export function SignUpForm() {
  const signUp = useSignUp()
  if (signUp.isSuccess)
    return (
      <AuthStatus title="Confirm your email">
        Check your inbox at <strong>{signUp.variables.email}</strong>: open the link we sent to confirm your address,
        then sign in.
      </AuthStatus>
    )
  return (
    <AuthForm
      id="sign-up"
      submitLabel="Create account"
      pending={signUp.isPending}
      error={signUp.error}
      onSubmit={(form) =>
        signUp.mutate({
          name: formText(form, 'name').trim(),
          email: formText(form, 'email').trim(),
          password: formText(form, 'password'),
        })
      }
    >
      <AuthField id="name" name="name" label="Name" autoComplete="name" maxLength={100} required />
      <AuthField id="email" name="email" label="Email" type="email" autoComplete="email" required />
      <AuthField
        id="password"
        name="password"
        label="Password"
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
