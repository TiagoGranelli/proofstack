import { revalidateLogic } from '@tanstack/react-form'
import { useNavigate } from '@tanstack/react-router'
import { Schema } from 'effect'
import { useAppForm } from '#/components/form/app-form.ts'
import { useSignIn } from '#/features/auth/api/sign-in.ts'
import { AuthForm } from '#/features/auth/components/auth-form.tsx'
import { safeRedirect } from '#/features/auth/utils/safe-redirect.ts'
import { SignInInput } from '#/lib/account-input.ts'

const validator = Schema.toStandardSchemaV1(SignInInput)
const decode = Schema.decodeSync(SignInInput)

/** Email and password sign-in. On success it goes to `redirectTo` if that is a safe same-origin path. */
export function LoginForm(props: { redirectTo?: string }) {
  const navigate = useNavigate()
  const signIn = useSignIn({
    mutationConfig: { onSuccess: () => navigate({ href: safeRedirect(props.redirectTo), replace: true }) },
  })
  const form = useAppForm({
    defaultValues: { email: '', password: '' },
    validationLogic: revalidateLogic(),
    validators: { onDynamic: validator },
    onSubmit: ({ value }) => signIn.mutate(decode(value)),
  })
  return (
    <AuthForm id="sign-in" submitLabel="Sign in" form={form} pending={signIn.isPending} error={signIn.error}>
      <form.AppField name="email">
        {(field) => <field.TextField id="email" label="Email" type="email" autoComplete="username" required />}
      </form.AppField>
      <form.AppField name="password">
        {(field) => (
          <field.TextField id="password" label="Password" type="password" autoComplete="current-password" required />
        )}
      </form.AppField>
    </AuthForm>
  )
}
