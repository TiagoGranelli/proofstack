import { type AuthMutationConfig, useAuthMutation } from '#/features/auth/api/auth-action.ts'
import { signOut } from '#/lib/auth.functions.ts'

/** Ends this session. The query cache is cleared before the caller's `onSuccess` navigates, so no private data survives. */
export function useSignOut({ mutationConfig }: { mutationConfig?: AuthMutationConfig<void> } = {}) {
  return useAuthMutation(() => signOut(), mutationConfig, { clearsCache: true })
}
