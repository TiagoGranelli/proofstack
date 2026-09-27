import { Link, createFileRoute, notFound, redirect } from '@tanstack/react-router'
import { Page } from '#/components/layouts/page.tsx'
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
    <Page title="Create an account" narrow>
      <SignUpForm />
      <p className="text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link to="/login" className="underline underline-offset-4">
          Sign in
        </Link>
        .
      </p>
    </Page>
  )
}
