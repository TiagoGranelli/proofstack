import { type AuthMutationConfig, type DataOf, useAuthMutation } from '#/features/auth/api/auth-action.ts'
import { resetPassword } from '#/lib/auth.functions.ts'

type ResetPasswordInput = DataOf<typeof resetPassword>

/** Sets a new password from a reset link. Every session of the account ends, this tab's included. */
export function useResetPassword({ mutationConfig }: { mutationConfig?: AuthMutationConfig<ResetPasswordInput> } = {}) {
  return useAuthMutation((data: ResetPasswordInput) => resetPassword({ data }), mutationConfig, { clearsCache: true })
}
