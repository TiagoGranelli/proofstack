import type * as Sdk from '#/sdk/sdk.gen.ts'

/** Distributes over the SDK's result union and keeps the `error` member of each variant. */
type ErrorBody<Result> = Result extends { error: infer E } ? E : never
/** The error body an SDK function can resolve with (`{ error }`), for every status its endpoint declares. */
type ErrorOf<F> = F extends (...args: never[]) => infer R ? ErrorBody<Awaited<R>> : never

/**
 * Every tagged error the contract can return, derived from the generated SDK: a new error on any endpoint
 * joins this union after `pnpm codegen`, and `describeApiError` stops compiling until it handles it.
 */
type TaggedApiError = {
  // Per function: an endpoint without declared errors yields `unknown`, which would swallow the whole union.
  [Fn in keyof typeof Sdk]: Extract<ErrorOf<(typeof Sdk)[Fn]>, { _tag: string }>
}[keyof typeof Sdk]

interface ApiErrorView {
  /** Sentence shown to the user. Never contains raw server output. */
  readonly message: string
  /** The session is gone: the UI should offer to sign in again. */
  readonly signIn: boolean
}

const isTaggedApiError = (error: unknown): error is TaggedApiError =>
  typeof error === 'object' && error !== null && '_tag' in error && typeof error._tag === 'string'

/** The contract error tag of an SDK error, or undefined for transport failures and non-JSON bodies. */
export const apiErrorTag = (error: unknown): TaggedApiError['_tag'] | undefined =>
  isTaggedApiError(error) ? error._tag : undefined

/**
 * The message of the first issue of a ValidationError that names `field` (its first path segment, a payload key
 * such as `body`), for a form that shows it next to that field; undefined for any other error.
 */
export function fieldIssue(error: unknown, field: string): string | undefined {
  if (!isTaggedApiError(error) || error._tag !== 'ValidationError') return undefined
  return error.issues.find((issue) => issue.path[0] === field)?.message
}

/**
 * Turns whatever the SDK threw into a user-facing message. The SDK throws the parsed JSON body for API
 * errors, the raw text for non-JSON bodies (CSRF "Forbidden", a proxy's 502 page), `{}` for an empty
 * body, and a TypeError when the network fails, so the input is `unknown`, not the declared error type.
 */
export function describeApiError(error: unknown, action: string): ApiErrorView {
  // fetch rejects with a TypeError when the request never got a response.
  if (error instanceof TypeError) {
    return { message: `Could not ${action}. Check your connection and try again.`, signIn: false }
  }
  if (!isTaggedApiError(error)) return { message: `Could not ${action}. Try again.`, signIn: false }
  switch (error._tag) {
    case 'ValidationError': {
      const details = error.issues.map((issue) => issue.message).join(' ')
      return { message: `Could not ${action}: ${details || error.message}`, signIn: false }
    }
    case 'Unauthorized':
      return { message: 'Your session has ended. Sign in again to continue.', signIn: true }
    case 'PostNotFound':
      return { message: 'This post no longer exists. It may have been deleted elsewhere.', signIn: false }
    case 'RateLimited':
      return {
        message: `Could not ${action}: too many changes in a short time. Try again in ${error.retryAfter} second${error.retryAfter === 1 ? '' : 's'}.`,
        signIn: false,
      }
    case 'ServiceUnavailable':
      return { message: 'The service is temporarily unavailable. Try again in a moment.', signIn: false }
    default: {
      // Fails to compile when the contract gains an error this switch does not handle. At runtime this is a
      // tag from a newer server than this client.
      const unhandled: never = error
      void unhandled
      return { message: `Could not ${action}. Try again.`, signIn: false }
    }
  }
}
