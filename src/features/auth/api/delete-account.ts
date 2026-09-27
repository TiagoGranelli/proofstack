import { useQueryClient } from '@tanstack/react-query'
import { type AuthMutationConfig, type DataOf, useAuthMutation } from '#/features/auth/api/auth-action.ts'
import { deleteAccount } from '#/lib/auth.functions.ts'

type DeleteAccountInput = DataOf<typeof deleteAccount>

/** Deletes the account and its posts. The cache is cleared before the caller navigates. */
export function useDeleteAccount({ mutationConfig }: { mutationConfig?: AuthMutationConfig<DeleteAccountInput> } = {}) {
  const queryClient = useQueryClient()
  return useAuthMutation((data: DeleteAccountInput) => deleteAccount({ data }), mutationConfig, {
    before: () => queryClient.clear(),
  })
}
