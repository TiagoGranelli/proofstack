// describeAuthFailure turns a failed account action into the sentence the UI shows. It must never show raw
// server output (a thrown message, an unknown Better Auth code), and each known code has its own message.
import { describe, expect, it } from 'vitest'
import { AuthActionError } from '#/features/auth/api/auth-action.ts'
import { describeAuthFailure } from '#/features/auth/utils/describe-auth-failure.ts'

const failure = (code: string, retryAfter?: number) => new AuthActionError({ code, retryAfter })

describe('describeAuthFailure', () => {
  // What a server function rejects with when the request failed or the handler threw.
  it.each<[string, unknown]>([
    ['a network error', new TypeError('Failed to fetch')],
    ['a thrown server error', new Error('duplicate key value violates unique constraint "user_email_key"')],
    ['a plain-text body', 'Internal Server Error'],
    ['an object that looks like a failure', { code: 'INVALID_PASSWORD' }],
    ['undefined', undefined],
  ])('asks to check the connection for %s, never showing it', (_, error) => {
    expect(describeAuthFailure(error)).toBe('Could not reach the server. Check your connection and try again.')
  })

  it.each([
    ['INVALID_EMAIL_OR_PASSWORD', 'Wrong email or password.'],
    ['INVALID_PASSWORD', 'That password is not correct.'],
    ['EMAIL_NOT_VERIFIED', 'Confirm your email address first. We have sent you a new link.'],
    ['PASSWORD_TOO_SHORT', 'Use at least 12 characters.'],
    ['PASSWORD_TOO_LONG', 'Use at most 128 characters.'],
    ['INVALID_TOKEN', 'This link is invalid or has expired. Ask for a new one.'],
    ['TOKEN_EXPIRED', 'This link is invalid or has expired. Ask for a new one.'],
    ['USER_NOT_FOUND', 'This link is invalid or has expired. Ask for a new one.'],
    ['SESSION_NOT_FRESH', 'For your security, sign in again to see your sessions.'],
    ['UNAUTHORIZED', 'Your session has ended. Sign in again to continue.'],
    ['SESSION_EXPIRED', 'Your session has ended. Sign in again to continue.'],
  ])('explains %s', (code, message) => {
    expect(describeAuthFailure(failure(code))).toBe(message)
  })

  it.each([
    [30, 'Too many attempts. Try again in 30 seconds.'],
    [1, 'Too many attempts. Try again in 1 second.'],
    [undefined, 'Too many attempts. Try again in a moment.'],
    [0, 'Too many attempts. Try again in a moment.'],
  ])('asks a rate-limited client to wait (Retry-After %s)', (retryAfter, message) => {
    expect(describeAuthFailure(failure('RATE_LIMITED', retryAfter))).toBe(message)
  })

  it.each(['UNEXPECTED', 'NOT_FOUND', 'FAILED_TO_CREATE_USER', 'relation "session" does not exist'])(
    'shows a generic message for %s, never the code',
    (code) => {
      expect(describeAuthFailure(failure(code))).toBe('Something went wrong. Try again.')
    },
  )
})
