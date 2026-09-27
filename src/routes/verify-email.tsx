import { createFileRoute } from '@tanstack/react-router'
import { pageTitle } from '#/config/app.ts'
import { ResendVerificationForm } from '#/features/auth/components/resend-verification-form.tsx'
import { VerifyEmailForm } from '#/features/auth/components/verify-email-form.tsx'

// Opened from the confirmation email (src/server/mail/auth-messages.ts). Loading the page only shows the
// "Confirm email" button; the address is confirmed when it is pressed (a POST), so a mail scanner or link
// preview that follows the link confirms nothing.
export const Route = createFileRoute('/verify-email')({
  validateSearch: (search: Record<string, unknown>): { token?: string } =>
    typeof search.token === 'string' && search.token ? { token: search.token } : {},
  head: () => ({ meta: [{ title: pageTitle('Confirm your email') }, { name: 'robots', content: 'noindex' }] }),
  headers: () => ({ 'cache-control': 'private, no-store' }),
  component: VerifyEmail,
})

function VerifyEmail() {
  const { token } = Route.useSearch()
  return (
    <main className="mx-auto grid max-w-sm gap-4 p-4">
      <h1 className="text-2xl font-semibold">Confirm your email</h1>
      {token ? (
        <VerifyEmailForm token={token} />
      ) : (
        <>
          <p>Open the link in the email we sent you. Did not get it? Ask for a new one.</p>
          <ResendVerificationForm />
        </>
      )}
    </main>
  )
}
