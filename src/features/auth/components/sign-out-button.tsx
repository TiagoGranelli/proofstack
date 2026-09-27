import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { Button } from '#/components/ui/button.tsx'
import { authClient } from '#/lib/auth-client.ts'

/**
 * Sign-out state shared by SignOutButton and SignOutAlert, so the page can place the button and its failure
 * alert apart. On success the query cache is cleared (no private data survives) and the user lands on `/`.
 */
export function useSignOut() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<'idle' | 'pending' | 'failed'>('idle')
  const signOut = async () => {
    setStatus('pending')
    try {
      const { error } = await authClient.signOut()
      if (error) return setStatus('failed')
    } catch {
      // The request never got a response (offline, connection reset).
      return setStatus('failed')
    }
    queryClient.clear()
    await navigate({ to: '/' })
  }
  return { status, signOut }
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
