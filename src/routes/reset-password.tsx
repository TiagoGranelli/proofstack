import { Link, createFileRoute } from '@tanstack/react-router'
import { Page } from '#/components/layouts/page.tsx'
import { pageTitle } from '#/config/app.ts'
import { ResetPasswordForm } from '#/features/auth/components/reset-password-form.tsx'

// Opened from the reset email (src/server/mail/auth-messages.ts). The token is checked when the form is sent.
export const Route = createFileRoute('/reset-password')({
  validateSearch: (search: Record<string, unknown>): { token?: string } =>
    typeof search.token === 'string' && search.token ? { token: search.token } : {},
  head: () => ({ meta: [{ title: pageTitle('Choose a new password') }, { name: 'robots', content: 'noindex' }] }),
  headers: () => ({ 'cache-control': 'private, no-store' }),
  component: ResetPassword,
})

function ResetPassword() {
  const { token } = Route.useSearch()
  return (
    <Page title="Choose a new password" narrow>
      {token ? (
        <ResetPasswordForm token={token} />
      ) : (
        <p>
          This page needs the link from the reset email.{' '}
          <Link to="/forgot-password" className="underline underline-offset-4">
            Ask for a new one
          </Link>
          .
        </p>
      )}
    </Page>
  )
}
