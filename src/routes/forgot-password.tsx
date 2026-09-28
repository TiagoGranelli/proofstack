import { Link, createFileRoute } from '@tanstack/react-router'
import { Page } from '#/components/layouts/page.tsx'
import { pageTitle } from '#/config/app.ts'
import { ForgotPasswordForm } from '#/features/auth/components/forgot-password-form.tsx'

export const Route = createFileRoute('/forgot-password')({
  head: () => ({ meta: [{ title: pageTitle('Forgot password') }, { name: 'robots', content: 'noindex' }] }),
  headers: () => ({ 'cache-control': 'private, no-store' }),
  component: ForgotPassword,
})

function ForgotPassword() {
  return (
    <Page title="Forgot your password?" description="We will email you a link to choose a new one." narrow>
      <ForgotPasswordForm />
      <p className="text-sm text-muted-foreground">
        <Link to="/login" className="underline underline-offset-4">
          Back to sign in
        </Link>
      </p>
    </Page>
  )
}
