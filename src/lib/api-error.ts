import type { RateLimited, ValidationError } from '#/contract/errors.ts'
import type * as Sdk from '#/sdk/sdk.gen.ts'

/** Distributes over the SDK's result union and keeps the `error` member of each variant. */
type ErrorBody<Result> = Result extends { error: infer E } ? E : never
/** The error body an SDK function can resolve with (`{ error }`), for every status its endpoint declares. */
type ErrorOf<F> = F extends (...args: never[]) => infer R ? ErrorBody<Awaited<R>> : never

/**
 * The errors of the shared middleware (RequestValidation, WriteRateLimit), from the contract: handled even while no
 * endpoint uses that middleware, so the first endpoint that does needs no new case.
 */
type MiddlewareError = (typeof ValidationError)['Encoded'] | (typeof RateLimited)['Encoded']

/**
 * Every tagged error the contract can return, derived from the generated SDK: a new error on any endpoint
 * joins this union after `pnpm codegen`, and `describeApiError` stops compiling until it handles it.
 */
type TaggedApiError =
  | {
      // Per function: an endpoint without declared errors yields `unknown`, which would swallow the whole union.
      [Fn in keyof typeof Sdk]: Extract<ErrorOf<(typeof Sdk)[Fn]>, { _tag: string }>
    }[keyof typeof Sdk]
  | MiddlewareError

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

type Describe<Tag extends TaggedApiError['_tag']> = (
  error: Extract<TaggedApiError, { _tag: Tag }>,
  action: string,
) => ApiErrorView

/**
 * The message of each contract error. The mapped type fails to compile when the contract gains an error this table
 * does not describe.
 */
const DESCRIBE_TAG: { readonly [Tag in TaggedApiError['_tag']]: Describe<Tag> } = {
  ValidationError: (error, action) => {
    const details = error.issues.map((issue) => issue.message).join(' ')
    return { message: `Could not ${action}: ${details || error.message}`, signIn: false }
  },
  Unauthorized: () => ({ message: 'Your session has ended. Sign in again to continue.', signIn: true }),
  PostNotFound: () => ({ message: 'This post no longer exists. It may have been deleted elsewhere.', signIn: false }),
  RateLimited: (error, action) => ({
    message: `Could not ${action}: too many changes in a short time. Try again in ${error.retryAfter} second${error.retryAfter === 1 ? '' : 's'}.`,
    signIn: false,
  }),
  ServiceUnavailable: () => ({
    message: 'The service is temporarily unavailable. Try again in a moment.',
    signIn: false,
  }),
}

/**
 * Turns whatever the SDK threw into a user-facing message. The SDK throws the parsed JSON body for API
 * errors, the raw text for non-JSON bodies (CSRF "Forbidden", a proxy's 502 page), `{}` for an empty
 * body, and a TypeError when the network fails, so the input is `unknown`, not the declared error type.
 *
 * @example describeApiError(error, 'publish the post').message // "Could not publish the post. Try again."
 */
export function describeApiError(error: unknown, action: string): ApiErrorView {
  // fetch rejects with a TypeError when the request never got a response.
  if (error instanceof TypeError) {
    return { message: `Could not ${action}. Check your connection and try again.`, signIn: false }
  }
  // An unknown tag at runtime comes from a newer server than this client.
  if (!isTaggedApiError(error) || !Object.hasOwn(DESCRIBE_TAG, error._tag)) {
    return { message: `Could not ${action}. Try again.`, signIn: false }
  }
  // TypeScript cannot relate a union member to its own entry of a mapped table (microsoft/TypeScript#30581), so
  // the entry is widened to the whole union here; the table's type checks each entry against its own tag.
  const describe = DESCRIBE_TAG[error._tag] as Describe<TaggedApiError['_tag']>
  return describe(error, action)
}
