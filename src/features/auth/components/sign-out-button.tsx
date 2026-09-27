import { Button } from '#/components/ui/button.tsx'
import type { useSignOut } from '#/features/auth/api/sign-out.ts'

type SignOut = ReturnType<typeof useSignOut>

/**
 * The sign-out button. It and its failure alert (`SignOutAlert`) share one `useSignOut()` mutation, so the page
 * can place them apart. Where the user lands afterwards is the caller's `onSuccess`; the cache is already cleared
 * by then. While pending the button is only `aria-disabled` and ignores presses: a disabled button loses focus,
 * and a keyboard user would be left on <body> if signing out fails (the same holds for every pending button).
 *
 * @example const signOut = useSignOut(); <SignOutButton signOut={signOut} /> … <SignOutAlert signOut={signOut} />
 */
export function SignOutButton(props: { signOut: SignOut }) {
  const { signOut } = props
  return (
    <Button
      type="button"
      variant="outline"
      aria-disabled={signOut.isPending || undefined}
      aria-busy={signOut.isPending}
      onClick={() => {
        if (!signOut.isPending) signOut.mutate()
      }}
    >
      Sign out
    </Button>
  )
}

/** Says that signing out failed, for the mutation `SignOutButton` started; nothing otherwise. */
export function SignOutAlert(props: { signOut: SignOut }) {
  return props.signOut.isError ? (
    <p role="alert" className="text-sm text-destructive">
      Could not sign out. Check your connection and try again.
    </p>
  ) : null
}
