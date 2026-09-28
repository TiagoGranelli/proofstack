import { revalidateLogic } from '@tanstack/react-form'
import { useAppForm } from '#/components/form/app-form.ts'
import { lazyFormSchema } from '#/components/form/lazy-schema.ts'
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '#/contract/limits.ts'
import { useSignUp } from '#/features/auth/api/sign-up.ts'
import { AuthForm } from '#/features/auth/components/auth-form.tsx'
import { AuthStatus } from '#/features/auth/components/auth-status.tsx'

const schema = lazyFormSchema(() => import('#/lib/account-input.ts').then((module) => module.SignUpInput))

// An address that already has an account is not a failure here (no enumeration, see signUp), so it has no field.
const FIELD_CODES = { INVALID_EMAIL: 'email', PASSWORD_TOO_SHORT: 'password', PASSWORD_TOO_LONG: 'password' } as const

/**
 * Creates an account. The answer is the same whether or not the address already has one (no enumeration):
 * either way the next step is in the inbox.
 */
export function SignUpForm() {
  const signUp = useSignUp()
  const form = useAppForm({
    defaultValues: { name: '', email: '', password: '' },
    validationLogic: revalidateLogic(),
    validators: { onDynamic: schema.validator },
    onSubmit: ({ value }) => signUp.mutate(schema.decode(value)),
  })
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
      form={form}
      schema={schema}
      pending={signUp.isPending}
      error={signUp.error}
      fieldCodes={FIELD_CODES}
    >
      <form.AppField name="name">
        {(field) => <field.TextField id="name" label="Name" autoComplete="name" maxLength={100} required />}
      </form.AppField>
      <form.AppField name="email">
        {(field) => <field.TextField id="email" label="Email" type="email" autoComplete="email" required />}
      </form.AppField>
      <form.AppField name="password">
        {(field) => (
          <field.TextField
            id="password"
            label="Password"
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
