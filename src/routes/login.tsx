import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect, useHydrated, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { Button } from '#/components/ui/button.tsx'
import { Input } from '#/components/ui/input.tsx'
import { Label } from '#/components/ui/label.tsx'
import { safeRedirect } from '#/features/auth/utils/safe-redirect.ts'
import { authClient } from '#/lib/auth-client.ts'
import { getSession } from '#/lib/session.functions.ts'

export const Route = createFileRoute('/login')({
  // `redirect` is set by the _authed guard. Anything that is not a same-origin path becomes /dashboard.
  validateSearch: (search: Record<string, unknown>): { redirect?: string } =>
    typeof search.redirect === 'string' ? { redirect: safeRedirect(search.redirect) } : {},
  // Asks the server, not client state: a signed-in visitor goes straight to where they were headed.
  beforeLoad: async ({ search }) => {
    if (await getSession()) throw redirect({ href: safeRedirect(search.redirect) })
  },
  head: () => ({ meta: [{ title: 'Sign in · ProofStack' }, { name: 'robots', content: 'noindex' }] }),
  component: Login,
})

function Login() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { redirect: target } = Route.useSearch()
  // A native submit before hydration must never send credentials, so the button waits for hydration.
  const hydrated = useHydrated()
  const [failure, setFailure] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  return (
    <main className="mx-auto grid max-w-sm gap-4 p-4">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <form
        method="post"
        className="grid gap-3"
        aria-busy={pending}
        aria-describedby={failure ? 'sign-in-error' : undefined}
        onSubmit={async (event) => {
          event.preventDefault()
          const form = new FormData(event.currentTarget)
          const field = (name: string) => {
            const value = form.get(name)
            return typeof value === 'string' ? value : ''
          }
          setPending(true)
          setFailure(null)
          try {
            const { error } = await authClient.signIn.email({ email: field('email'), password: field('password') })
            if (error) return setFailure(error.message ?? 'Sign-in failed. Try again.')
          } catch {
            return setFailure('Could not reach the server. Check your connection and try again.')
          } finally {
            setPending(false)
          }
          // Nothing cached for a previous user in this tab (their private posts) may survive a sign-in.
          queryClient.clear()
          await navigate({ href: safeRedirect(target), replace: true })
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" autoComplete="username" required />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="password">Password</Label>
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </div>
        <Button type="submit" disabled={!hydrated || pending}>
          Sign in
        </Button>
        {failure ? (
          <p id="sign-in-error" role="alert" className="text-sm text-destructive">
            {failure}
          </p>
        ) : null}
      </form>
    </main>
  )
}
