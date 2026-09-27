import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '#/contract/limits.ts'
import { AuthActionError } from '#/features/auth/api/auth-action.ts'

/**
 * A sentence for a failed account action. `error` is what the mutation or query rejected with: an
 * AuthActionError carrying Better Auth's code, or anything else when the server could not be reached.
 */
export function describeAuthFailure(error: unknown): string {
  if (!(error instanceof AuthActionError)) return 'Could not reach the server. Check your connection and try again.'
  switch (error.code) {
    case 'INVALID_EMAIL_OR_PASSWORD':
      return 'Wrong email or password.'
    case 'INVALID_PASSWORD':
      return 'That password is not correct.'
    case 'EMAIL_NOT_VERIFIED':
      return 'Confirm your email address first. We have sent you a new link.'
    case 'PASSWORD_TOO_SHORT':
      return `Use at least ${PASSWORD_MIN_LENGTH} characters.`
    case 'PASSWORD_TOO_LONG':
      return `Use at most ${PASSWORD_MAX_LENGTH} characters.`
    case 'INVALID_TOKEN':
    case 'TOKEN_EXPIRED':
    case 'USER_NOT_FOUND':
      return 'This link is invalid or has expired. Ask for a new one.'
    case 'SESSION_NOT_FRESH':
      return 'For your security, sign in again to see your sessions.'
    case 'UNAUTHORIZED':
    case 'SESSION_EXPIRED':
      return 'Your session has ended. Sign in again to continue.'
    case 'RATE_LIMITED':
      return error.retryAfter
        ? `Too many attempts. Try again in ${error.retryAfter} second${error.retryAfter === 1 ? '' : 's'}.`
        : 'Too many attempts. Try again in a moment.'
    default:
      return 'Something went wrong. Try again.'
  }
}
