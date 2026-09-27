import { Link, createFileRoute, notFound, redirect } from '@tanstack/react-router'
import { pageTitle } from '#/config/app.ts'
import { SignUpForm } from '#/features/auth/components/sign-up-form.tsx'
import { getSignUpPolicy } from '#/lib/auth.functions.ts'
import { getSession } from '#/lib/session.functions.ts'

export const Route = createFileRoute('/sign-up')({
  // With AUTH_SIGN_UP=closed the page does not exist (404), like the endpoint behind it.
  beforeLoad: async () => {
    const [policy, session] = await Promise.all([getSignUpPolicy(), getSession()])
    if (!policy.open) throw notFound()
    if (session) throw redirect({ to: '/dashboard' })
  },
  head: () => ({ meta: [{ title: pageTitle('Create an account') }, { name: 'robots', content: 'noindex' }] }),
  headers: () => ({ 'cache-control': 'private, no-store' }),
  component: SignUp,
})

function SignUp() {
  return (
    <main className="mx-auto grid max-w-sm gap-4 p-4">
      <h1 className="text-2xl font-semibold">Create an account</h1>
      <SignUpForm />
      <p className="text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link to="/login" className="underline underline-offset-4">
          Sign in
        </Link>
        .
      </p>
    </main>
  )
}
