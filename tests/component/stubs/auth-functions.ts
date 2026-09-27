// Stands in for #/lib/auth.functions.ts in the `component` Vitest project (resolve.alias in vitest.config.ts).
// The real module is a set of server functions: Start's compiler turns each into a POST to /_serverFn/<id>
// in client bundles, and Vitest does not run that compiler (the handlers would pull Better Auth and the
// database into the browser). Here each one is a POST to /_serverFn/auth/<name> with its `data` as JSON,
// answered by the MSW worker (`auth` in tests/component/api-mocks.ts). Like the real client, it resolves with
// the handler's AuthOutcome and rejects when the request fails or the handler threw (a non-2xx answer).
import type * as AuthFunctions from '#/lib/auth.functions.ts'

export type AuthFunctionName = keyof typeof AuthFunctions

/** The URL the stub of server function `name` posts to. */
export const authFunctionPath = (name: AuthFunctionName) => `/_serverFn/auth/${name}`

/** Like the compiled client: a function that posts, with the `url` a form can post to. */
const serverFunction = (name: AuthFunctionName) =>
  Object.assign(
    async (options?: { data?: unknown }): Promise<unknown> => {
      const res = await fetch(authFunctionPath(name), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(options?.data ?? null),
      })
      if (!res.ok) throw new Error(`server function ${name} failed with ${res.status}`)
      return res.json()
    },
    { url: authFunctionPath(name) },
  )

export const getSignUpPolicy = serverFunction('getSignUpPolicy')
export const signIn = serverFunction('signIn')
export const signInFromForm = serverFunction('signInFromForm')
export const signOut = serverFunction('signOut')
export const signUp = serverFunction('signUp')
export const resendVerification = serverFunction('resendVerification')
export const verifyEmail = serverFunction('verifyEmail')
export const requestPasswordReset = serverFunction('requestPasswordReset')
export const resetPassword = serverFunction('resetPassword')
export const changePassword = serverFunction('changePassword')
export const listSessions = serverFunction('listSessions')
export const revokeSession = serverFunction('revokeSession')
export const revokeOtherSessions = serverFunction('revokeOtherSessions')
export const signOutEverywhere = serverFunction('signOutEverywhere')
export const deleteAccount = serverFunction('deleteAccount')
