// describeAuthFailure turns a failed account action into the sentence the UI shows. It must never show raw
// server output (a thrown message, an unknown Better Auth code), and each known code has its own message.
import { describe, expect, it } from 'vitest'
import { AuthActionError } from '#/features/auth/api/auth-action.ts'
import {
  describeAuthFailure,
  failureFromSearch,
  isAuthFailureCode,
} from '#/features/auth/utils/describe-auth-failure.ts'
import type { AuthFailureCode } from '#/lib/auth.functions.ts'

const failure = (code: AuthFailureCode, retryAfter?: number) => new AuthActionError({ code, retryAfter })

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

  it.each<[AuthFailureCode, string]>([
    ['INVALID_EMAIL_OR_PASSWORD', 'Wrong email or password.'],
    ['INVALID_EMAIL', 'Enter a valid email address.'],
    ['INVALID_PASSWORD', 'That password is not correct.'],
    ['EMAIL_ALREADY_VERIFIED', 'This email address is already confirmed.'],
    ['INVALID_USER', 'This link is invalid or has expired. Ask for a new one.'],
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

  it.each<AuthFailureCode>([
    'INVALID_ORIGIN',
    'MISSING_OR_NULL_ORIGIN',
    'CROSS_SITE_NAVIGATION_LOGIN_BLOCKED',
    'VALIDATION_ERROR',
    'EMAIL_MISMATCH',
    'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL',
    'CREDENTIAL_ACCOUNT_NOT_FOUND',
    'FAILED_TO_CREATE_USER',
    'FAILED_TO_CREATE_SESSION',
    'FAILED_TO_GET_SESSION',
    'NOT_FOUND',
    'UNEXPECTED',
  ])('shows a generic message for %s, never the code', (code) => {
    expect(describeAuthFailure(failure(code))).toBe('Something went wrong. Try again.')
  })

  it('shows the generic message for a code from a newer server, never the code', () => {
    // A server deployed after this client can send a code the union does not have yet.
    const fromNewerServer = new AuthActionError({ code: 'UNEXPECTED' })
    Object.defineProperty(fromNewerServer, 'code', { value: 'relation "session" does not exist' })
    expect(describeAuthFailure(fromNewerServer)).toBe('Something went wrong. Try again.')
  })
})

describe('isAuthFailureCode', () => {
  it.each(['INVALID_EMAIL_OR_PASSWORD', 'RATE_LIMITED', 'UNEXPECTED', 'SESSION_NOT_FRESH'])('knows %s', (code) => {
    expect(isAuthFailureCode(code)).toBe(true)
  })

  // A code read from the URL (/login?error=...) is only shown when it is one of ours.
  it.each(['', 'invalid_email_or_password', 'toString', '__proto__', 'constructor', '<script>'])(
    'refuses %j',
    (code) => {
      expect(isAuthFailureCode(code)).toBe(false)
    },
  )
})

describe('failureFromSearch', () => {
  it.each<[string, Record<string, unknown>, ReturnType<typeof failureFromSearch>]>([
    ['a known code', { error: 'INVALID_EMAIL_OR_PASSWORD' }, { error: 'INVALID_EMAIL_OR_PASSWORD' }],
    [
      'a rate limit with its wait',
      { error: 'RATE_LIMITED', retryAfter: 30 },
      { error: 'RATE_LIMITED', retryAfter: 30 },
    ],
    [
      'a wait that is not a whole positive number',
      { error: 'RATE_LIMITED', retryAfter: 1.5 },
      { error: 'RATE_LIMITED' },
    ],
    ['a wait of zero', { error: 'RATE_LIMITED', retryAfter: 0 }, { error: 'RATE_LIMITED' }],
    ['a wait as text', { error: 'RATE_LIMITED', retryAfter: '30' }, { error: 'RATE_LIMITED' }],
    ['an unknown code', { error: 'DROP TABLE', retryAfter: 30 }, {}],
    ['a code that is not text', { error: ['INVALID_PASSWORD'] }, {}],
    ['nothing', { redirect: '/dashboard' }, {}],
  ])('reads %s', (_, search, expected) => {
    expect(failureFromSearch(search)).toEqual(expected)
  })
})
