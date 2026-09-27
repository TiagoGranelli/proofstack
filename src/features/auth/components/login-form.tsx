import { useNavigate } from '@tanstack/react-router'
import { useSignIn } from '#/features/auth/api/sign-in.ts'
import { AuthField, AuthForm } from '#/features/auth/components/auth-form.tsx'
import { formText } from '#/features/auth/utils/form-text.ts'
import { safeRedirect } from '#/features/auth/utils/safe-redirect.ts'

/** Email and password sign-in. On success it goes to `redirectTo` if that is a safe same-origin path. */
export function LoginForm(props: { redirectTo?: string }) {
  const navigate = useNavigate()
  const signIn = useSignIn({
    mutationConfig: { onSuccess: () => navigate({ href: safeRedirect(props.redirectTo), replace: true }) },
  })
  return (
    <AuthForm
      id="sign-in"
      submitLabel="Sign in"
      pending={signIn.isPending}
      error={signIn.error}
      onSubmit={(form) => signIn.mutate({ email: formText(form, 'email'), password: formText(form, 'password') })}
    >
      <AuthField id="email" name="email" label="Email" type="email" autoComplete="username" required />
      <AuthField
        id="password"
        name="password"
        label="Password"
        type="password"
        autoComplete="current-password"
        required
      />
    </AuthForm>
  )
}
