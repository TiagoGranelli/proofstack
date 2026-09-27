import { type AuthMutationConfig, type DataOf, useAuthMutation } from '#/features/auth/api/auth-action.ts'
import { sessionsQueryKey } from '#/features/auth/api/get-sessions.ts'
import { changePassword } from '#/lib/auth.functions.ts'

type ChangePasswordInput = DataOf<typeof changePassword>

/** Changes the password and ends every other session of the account; the session list is then refetched. */
export function useChangePassword({
  mutationConfig,
}: { mutationConfig?: AuthMutationConfig<ChangePasswordInput> } = {}) {
  return useAuthMutation((data: ChangePasswordInput) => changePassword({ data }), mutationConfig, {
    invalidates: [{ queryKey: sessionsQueryKey }],
  })
}
