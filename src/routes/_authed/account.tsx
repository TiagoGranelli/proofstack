import { createFileRoute } from '@tanstack/react-router'
import { RouteError } from '#/components/errors/route-error.tsx'
import { SectionErrorBoundary } from '#/components/errors/section-error-boundary.tsx'
import { Page } from '#/components/layouts/page.tsx'
import { pageTitle } from '#/config/app.ts'
import { getSessionsQueryOptions } from '#/features/auth/api/get-sessions.ts'
import { ChangePasswordForm } from '#/features/auth/components/change-password-form.tsx'
import { DeleteAccountForm } from '#/features/auth/components/delete-account-form.tsx'
import { SessionList } from '#/features/auth/components/session-list.tsx'

export const Route = createFileRoute('/_authed/account')({
  loader: ({ context }) => context.queryClient.query({ ...getSessionsQueryOptions(), staleTime: 'static' }),
  head: () => ({ meta: [{ title: pageTitle('Account') }, { name: 'robots', content: 'noindex' }] }),
  // The loader's failures. Once the page is up, each section fails on its own (SectionErrorBoundary).
  errorComponent: (props) => (
    <RouteError {...props} title="Your account could not be loaded" action="load your account" />
  ),
  component: Account,
})

const section = 'grid gap-4 border-t pt-8'
const heading = 'text-lg font-semibold tracking-tight'

function Account() {
  const { user } = Route.useRouteContext()
  return (
    <Page title="Account" description={`${user.name} · ${user.email}`}>
      <section aria-labelledby="password-heading" className={section}>
        <h2 id="password-heading" className={heading}>
          Password
        </h2>
        <SectionErrorBoundary action="show the password form">
          <ChangePasswordForm />
        </SectionErrorBoundary>
      </section>
      <section aria-labelledby="sessions-heading" className={section}>
        <h2 id="sessions-heading" className={heading}>
          Sessions
        </h2>
        <SectionErrorBoundary action="show your sessions">
          <SessionList />
        </SectionErrorBoundary>
      </section>
      <section aria-labelledby="delete-heading" className={section}>
        <h2 id="delete-heading" className={heading}>
          Delete account
        </h2>
        <SectionErrorBoundary action="show the delete form">
          <DeleteAccountForm />
        </SectionErrorBoundary>
      </section>
    </Page>
  )
}
