import { type AuthMutationConfig, type DataOf, useAuthMutation } from '#/features/auth/api/auth-action.ts'
import { deleteAccount } from '#/lib/auth.functions.ts'

type DeleteAccountInput = DataOf<typeof deleteAccount>

/** Deletes the account and everything it owns. The cache is cleared before the caller navigates. */
export function useDeleteAccount({ mutationConfig }: { mutationConfig?: AuthMutationConfig<DeleteAccountInput> } = {}) {
  return useAuthMutation((data: DeleteAccountInput) => deleteAccount({ data }), mutationConfig, { clearsCache: true })
}
