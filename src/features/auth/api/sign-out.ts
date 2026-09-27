import { useQueryClient } from '@tanstack/react-query'
import { type AuthMutationConfig, useAuthMutation } from '#/features/auth/api/auth-action.ts'
import { signOut } from '#/lib/auth.functions.ts'

/** Ends this session. The query cache is cleared before the caller navigates, so no private data survives. */
export function useSignOutMutation({ mutationConfig }: { mutationConfig?: AuthMutationConfig<void> } = {}) {
  const queryClient = useQueryClient()
  return useAuthMutation(() => signOut(), mutationConfig, { before: () => queryClient.clear() })
}
