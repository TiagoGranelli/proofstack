import { useQueryClient } from '@tanstack/react-query'
import { type AuthMutationConfig, useAuthMutation } from '#/features/auth/api/auth-action.ts'
import { signOutEverywhere } from '#/lib/auth.functions.ts'

/** Ends every session of the account, this one included. The cache is cleared before the caller navigates. */
export function useSignOutEverywhere({ mutationConfig }: { mutationConfig?: AuthMutationConfig<void> } = {}) {
  const queryClient = useQueryClient()
  return useAuthMutation(() => signOutEverywhere(), mutationConfig, { before: () => queryClient.clear() })
}
