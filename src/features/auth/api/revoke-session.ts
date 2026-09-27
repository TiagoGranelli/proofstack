import { type AuthMutationConfig, type DataOf, useAuthMutation } from '#/features/auth/api/auth-action.ts'
import { sessionsQueryKey } from '#/features/auth/api/get-sessions.ts'
import { revokeSession } from '#/lib/auth.functions.ts'

type RevokeSessionInput = DataOf<typeof revokeSession>

/** Ends one of the account's sessions; the session list is then refetched. */
export function useRevokeSession({ mutationConfig }: { mutationConfig?: AuthMutationConfig<RevokeSessionInput> } = {}) {
  return useAuthMutation((data: RevokeSessionInput) => revokeSession({ data }), mutationConfig, {
    invalidates: [{ queryKey: sessionsQueryKey }],
  })
}
