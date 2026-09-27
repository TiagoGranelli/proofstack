import { useNavigate } from '@tanstack/react-router'
import { Button } from '#/components/ui/button.tsx'
import { useSignOutMutation } from '#/features/auth/api/sign-out.ts'

/**
 * Sign-out state shared by SignOutButton and SignOutAlert, so the page can place the button and its failure
 * alert apart. On success the query cache is cleared (no private data survives) and the user lands on `/`.
 */
export function useSignOut() {
  const navigate = useNavigate()
  const mutation = useSignOutMutation({ mutationConfig: { onSuccess: () => navigate({ to: '/' }) } })
  const status: 'idle' | 'pending' | 'failed' = mutation.isPending ? 'pending' : mutation.isError ? 'failed' : 'idle'
  return { status, signOut: () => mutation.mutate() }
}

type SignOut = ReturnType<typeof useSignOut>

export function SignOutButton(props: { signOut: SignOut }) {
  const { status, signOut } = props.signOut
  return (
    <Button
      type="button"
      variant="outline"
      disabled={status === 'pending'}
      aria-busy={status === 'pending'}
      onClick={signOut}
    >
      Sign out
    </Button>
  )
}

export function SignOutAlert(props: { signOut: SignOut }) {
  return props.signOut.status === 'failed' ? (
    <p role="alert" className="text-sm text-destructive">
      Could not sign out. Check your connection and try again.
    </p>
  ) : null
}
