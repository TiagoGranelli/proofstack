import { Link, createFileRoute } from '@tanstack/react-router'
import { pageTitle } from '#/config/app.ts'
import { ForgotPasswordForm } from '#/features/auth/components/forgot-password-form.tsx'

export const Route = createFileRoute('/forgot-password')({
  head: () => ({ meta: [{ title: pageTitle('Forgot password') }, { name: 'robots', content: 'noindex' }] }),
  headers: () => ({ 'cache-control': 'private, no-store' }),
  component: ForgotPassword,
})

function ForgotPassword() {
  return (
    <main className="mx-auto grid max-w-sm gap-4 p-4">
      <h1 className="text-2xl font-semibold">Forgot your password?</h1>
      <p className="text-sm text-muted-foreground">We will email you a link to choose a new one.</p>
      <ForgotPasswordForm />
      <p className="text-sm text-muted-foreground">
        <Link to="/login" className="underline underline-offset-4">
          Back to sign in
        </Link>
      </p>
    </main>
  )
}
