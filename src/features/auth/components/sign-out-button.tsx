import { Button } from '#/components/ui/button.tsx'
import type { useSignOut } from '#/features/auth/api/sign-out.ts'

/**
 * The sign-out button and its failure alert share one `useSignOut()` mutation, so the page can place them
 * apart. Where the user lands afterwards is the caller's `onSuccess`; the cache is already cleared by then.
 */
type SignOut = ReturnType<typeof useSignOut>

export function SignOutButton(props: { signOut: SignOut }) {
  const { signOut } = props
  return (
    <Button
      type="button"
      variant="outline"
      disabled={signOut.isPending}
      aria-busy={signOut.isPending}
      onClick={() => signOut.mutate()}
    >
      Sign out
    </Button>
  )
}

export function SignOutAlert(props: { signOut: SignOut }) {
  return props.signOut.isError ? (
    <p role="alert" className="text-sm text-destructive">
      Could not sign out. Check your connection and try again.
    </p>
  ) : null
}
