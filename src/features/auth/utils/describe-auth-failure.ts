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
