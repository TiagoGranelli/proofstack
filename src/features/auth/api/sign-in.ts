import { type AuthMutationConfig, type DataOf, useAuthMutation } from '#/features/auth/api/auth-action.ts'
import { signIn } from '#/lib/auth.functions.ts'

type SignInInput = DataOf<typeof signIn>

/** Signs in. Nothing cached for a previous user in this tab (their private data) survives it. */
export function useSignIn({ mutationConfig }: { mutationConfig?: AuthMutationConfig<SignInInput> } = {}) {
  return useAuthMutation((data: SignInInput) => signIn({ data }), mutationConfig, { clearsCache: true })
}
