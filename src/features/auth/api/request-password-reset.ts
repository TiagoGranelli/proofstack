import { type AuthMutationConfig, type DataOf, useAuthMutation } from '#/features/auth/api/auth-action.ts'
import { requestPasswordReset } from '#/lib/auth.functions.ts'

type RequestPasswordResetInput = DataOf<typeof requestPasswordReset>

/** Mails a reset link if the address has an account; succeeds the same otherwise. */
export function useRequestPasswordReset({
  mutationConfig,
}: { mutationConfig?: AuthMutationConfig<RequestPasswordResetInput> } = {}) {
  return useAuthMutation((data: RequestPasswordResetInput) => requestPasswordReset({ data }), mutationConfig)
}
