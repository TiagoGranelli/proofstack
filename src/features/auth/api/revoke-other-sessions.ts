import { type AuthMutationConfig, useAuthMutation } from '#/features/auth/api/auth-action.ts'
import { sessionsQueryKey } from '#/features/auth/api/get-sessions.ts'
import { revokeOtherSessions } from '#/lib/auth.functions.ts'

/** Ends every session of the account except this one; the session list is then refetched. */
export function useRevokeOtherSessions({ mutationConfig }: { mutationConfig?: AuthMutationConfig<void> } = {}) {
  return useAuthMutation(() => revokeOtherSessions(), mutationConfig, { invalidates: [{ queryKey: sessionsQueryKey }] })
}
