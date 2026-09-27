import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '#/contract/limits.ts'
import { AuthActionError } from '#/features/auth/api/auth-action.ts'
import type { AuthFailureCode } from '#/lib/auth.functions.ts'

const GENERIC = 'Something went wrong. Try again.'
const EXPIRED_LINK = 'This link is invalid or has expired. Ask for a new one.'
const SESSION_ENDED = 'Your session has ended. Sign in again to continue.'

/**
 * One sentence per failure code. Typed over the whole closed union (AuthFailureCode), so a new code fails the
 * typecheck until it gets its sentence here, as a new API error does in describeApiError.
 */
const MESSAGES: Record<Exclude<AuthFailureCode, 'RATE_LIMITED'>, string> = {
  INVALID_EMAIL_OR_PASSWORD: 'Wrong email or password.',
  INVALID_EMAIL: 'Enter a valid email address.',
  INVALID_PASSWORD: 'That password is not correct.',
  EMAIL_NOT_VERIFIED: 'Confirm your email address first. We have sent you a new link.',
  EMAIL_ALREADY_VERIFIED: 'This email address is already confirmed.',
  PASSWORD_TOO_SHORT: `Use at least ${PASSWORD_MIN_LENGTH} characters.`,
  PASSWORD_TOO_LONG: `Use at most ${PASSWORD_MAX_LENGTH} characters.`,
  INVALID_TOKEN: EXPIRED_LINK,
  TOKEN_EXPIRED: EXPIRED_LINK,
  USER_NOT_FOUND: EXPIRED_LINK,
  INVALID_USER: EXPIRED_LINK,
  SESSION_NOT_FRESH: 'For your security, sign in again to see your sessions.',
  UNAUTHORIZED: SESSION_ENDED,
  SESSION_EXPIRED: SESSION_ENDED,
  // Nothing the user can fix from the form: a request from another origin, input the UI never sends, an address
  // that belongs to another signed-in account, or a failure on the server.
  INVALID_ORIGIN: GENERIC,
  MISSING_OR_NULL_ORIGIN: GENERIC,
  CROSS_SITE_NAVIGATION_LOGIN_BLOCKED: GENERIC,
  VALIDATION_ERROR: GENERIC,
  EMAIL_MISMATCH: GENERIC,
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: GENERIC,
  CREDENTIAL_ACCOUNT_NOT_FOUND: GENERIC,
  FAILED_TO_CREATE_USER: GENERIC,
  FAILED_TO_CREATE_SESSION: GENERIC,
  FAILED_TO_GET_SESSION: GENERIC,
  NOT_FOUND: GENERIC,
  UNEXPECTED: GENERIC,
}

/** Whether `value` is a failure code this client knows (a code from the URL, for example). */
export const isAuthFailureCode = (value: string): value is AuthFailureCode =>
  value === 'RATE_LIMITED' || Object.hasOwn(MESSAGES, value)

/**
 * The failure a sign-in posted without JavaScript reports in the URL (`/login?error=…&retryAfter=…`, see
 * signInFromForm), when its code is one of ours; anything else in the URL is ignored.
 */
export function failureFromSearch(search: Record<string, unknown>): { error?: AuthFailureCode; retryAfter?: number } {
  const { error, retryAfter } = search
  if (typeof error !== 'string' || !isAuthFailureCode(error)) return {}
  const wait = typeof retryAfter === 'number' && Number.isInteger(retryAfter) && retryAfter > 0
  return wait ? { error, retryAfter } : { error }
}

const retryIn = (seconds: number | undefined) =>
  seconds !== undefined && seconds > 0
    ? `Too many attempts. Try again in ${seconds} second${seconds === 1 ? '' : 's'}.`
    : 'Too many attempts. Try again in a moment.'

/**
 * A sentence for a failed account action. `error` is what the mutation or query rejected with: an
 * AuthActionError carrying a failure code, or anything else when the server could not be reached.
 */
export function describeAuthFailure(error: unknown): string {
  if (!(error instanceof AuthActionError)) return 'Could not reach the server. Check your connection and try again.'
  if (error.code === 'RATE_LIMITED') return retryIn(error.retryAfter)
  // A code from a newer server than this client is not in the table.
  return Object.hasOwn(MESSAGES, error.code) ? MESSAGES[error.code] : GENERIC
}

/** Which field of a form each failure code is about, for the codes that form can pin on a field. */
export type AuthFieldCodes = Partial<Record<AuthFailureCode, string>>

/**
 * A failure that is about one field of the form that sent it, as `{ [field]: sentence }` for the form's
 * ServerIssues (src/components/form/server-issues.ts), or `{}` when it concerns the whole form. The same code can
 * mean different fields: a wrong password is the current password when changing it, the password when deleting
 * the account.
 *
 * @example authFieldIssues(error, { INVALID_PASSWORD: 'currentPassword' }) // { currentPassword: 'That password is not correct.' }
 */
export function authFieldIssues(error: unknown, fields: AuthFieldCodes): Record<string, string> {
  if (!(error instanceof AuthActionError)) return {}
  const field = fields[error.code]
  return field === undefined ? {} : { [field]: describeAuthFailure(error) }
}
