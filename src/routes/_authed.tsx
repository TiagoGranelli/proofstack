import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'
import { getSession } from '#/lib/session.functions.ts'

// UX guard only: every private API operation re-checks the session in the Effect Authentication middleware.
export const Route = createFileRoute('/_authed')({
  beforeLoad: async ({ location }) => {
    const session = await getSession()
    // /login validates `redirect` (same-origin paths only) before navigating to it after sign-in.
    if (!session) throw redirect({ to: '/login', search: { redirect: location.href } })
    return { user: session.user }
  },
  headers: () => ({ 'cache-control': 'private, no-store' }),
  component: Outlet,
})
