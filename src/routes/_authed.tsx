import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'
import { fetchFreshSession } from '#/features/auth/api/get-session.ts'

// UX guard only: every private API operation re-checks the session in the Effect Authentication middleware.
export const Route = createFileRoute('/_authed')({
  beforeLoad: async ({ context, location }) => {
    // Asks the server on every navigation here; the site header then shows the same answer (readSession).
    const session = await fetchFreshSession(context.queryClient)
    // /login validates `redirect` (same-origin paths only) before navigating to it after sign-in.
    if (!session) throw redirect({ to: '/login', search: { redirect: location.href } })
    return { user: session.user }
  },
  headers: () => ({ 'cache-control': 'private, no-store' }),
  component: Outlet,
})
