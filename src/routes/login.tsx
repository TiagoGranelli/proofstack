import { Link, createFileRoute, redirect } from '@tanstack/react-router'
import { LoginForm } from '#/features/auth/components/login-form.tsx'
import { safeRedirect } from '#/features/auth/utils/safe-redirect.ts'
import { getSignUpPolicy } from '#/lib/auth.functions.ts'
import { getSession } from '#/lib/session.functions.ts'

const link = 'underline underline-offset-4'

export const Route = createFileRoute('/login')({
  // `redirect` is set by the _authed guard. Anything that is not a same-origin path becomes /dashboard.
  validateSearch: (search: Record<string, unknown>): { redirect?: string } =>
    typeof search.redirect === 'string' ? { redirect: safeRedirect(search.redirect) } : {},
  // Asks the server, not client state: a signed-in visitor goes straight to where they were headed.
  beforeLoad: async ({ search }) => {
    if (await getSession()) throw redirect({ href: safeRedirect(search.redirect) })
  },
  loader: () => getSignUpPolicy(),
  head: () => ({ meta: [{ title: 'Sign in · ProofStack' }, { name: 'robots', content: 'noindex' }] }),
  headers: () => ({ 'cache-control': 'private, no-store' }),
  component: Login,
})

function Login() {
  const { redirect: target } = Route.useSearch()
  const signUp = Route.useLoaderData()
  return (
    <main className="mx-auto grid max-w-sm gap-4 p-4">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <LoginForm redirectTo={target} />
      <p className="text-sm text-muted-foreground">
        <Link to="/forgot-password" className={link}>
          Forgot your password?
        </Link>
      </p>
      {signUp.open ? (
        <p className="text-sm text-muted-foreground">
          No account yet?{' '}
          <Link to="/sign-up" className={link}>
            Create one
          </Link>
          .
        </p>
      ) : null}
    </main>
  )
}
