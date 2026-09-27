import { type MutationMeta, useMutation, type UseMutationOptions } from '@tanstack/react-query'
import type { AuthFailure, AuthFailureCode, AuthOutcome } from '#/lib/auth.functions.ts'

/** A failed account action, thrown so TanStack Query reports it as the mutation's (or query's) error. */
export class AuthActionError extends Error {
  readonly code: AuthFailureCode
  readonly retryAfter: number | undefined

  constructor(failure: AuthFailure) {
    super(failure.code)
    this.name = 'AuthActionError'
    this.code = failure.code
    this.retryAfter = failure.retryAfter
  }
}

/** The value of a successful outcome; throws AuthActionError for a failed one. */
const unwrap = <T>(outcome: AuthOutcome<T>): T => {
  if (!outcome.ok) throw new AuthActionError(outcome.failure)
  return outcome.value
}

/** The `data` a server function takes. */
export type DataOf<F> = F extends (options: { data: infer D }) => unknown ? D : never

export type AuthMutationConfig<TInput, TOutput = null> = Omit<
  UseMutationOptions<TOutput, Error, TInput>,
  'mutationFn' | 'onSuccess'
> & { onSuccess?: (data: TOutput, input: TInput) => unknown }

/**
 * A mutation over an account server function. `effects` declares what it does to the cache (src/lib/query-client.ts
 * performs it): `clearsCache` before the caller's `onSuccess` (navigate, announce), `invalidates` after it.
 */
export function useAuthMutation<TInput, TOutput>(
  action: (input: TInput) => Promise<AuthOutcome<TOutput>>,
  config: AuthMutationConfig<TInput, TOutput> | undefined,
  effects: MutationMeta = {},
) {
  return useMutation({
    ...config,
    mutationFn: async (input: TInput) => unwrap(await action(input)),
    meta: effects,
  })
}
