import { createFileRoute } from '@tanstack/react-router'
import { RouteError } from '#/components/errors/route-error.tsx'
import { SectionErrorBoundary } from '#/components/errors/section-error-boundary.tsx'
import { getSessionsQueryOptions } from '#/features/auth/api/get-sessions.ts'
import { ChangePasswordForm } from '#/features/auth/components/change-password-form.tsx'
import { DeleteAccountForm } from '#/features/auth/components/delete-account-form.tsx'
import { SessionList } from '#/features/auth/components/session-list.tsx'

export const Route = createFileRoute('/_authed/account')({
  head: () => ({ meta: [{ title: 'Account · ProofStack' }, { name: 'robots', content: 'noindex' }] }),
  loader: ({ context }) => context.queryClient.query({ ...getSessionsQueryOptions(), staleTime: 'static' }),
  // The loader's failures. Once the page is up, each section fails on its own (SectionErrorBoundary).
  errorComponent: (props) => (
    <RouteError {...props} title="Your account could not be loaded" action="load your account" />
  ),
  component: Account,
})

const section = 'grid gap-3 border-t pt-6'
const heading = 'text-lg font-semibold'

function Account() {
  const { user } = Route.useRouteContext()
  return (
    <main className="mx-auto grid max-w-2xl gap-6 p-4">
      <div className="grid gap-1">
        <h1 className="text-2xl font-semibold">Account</h1>
        <p className="text-muted-foreground">
          {user.name} · {user.email}
        </p>
      </div>
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
    </main>
  )
}
