import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'
import { Schema } from 'effect'
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '#/contract/limits.ts'
import { env } from '#/server/env.ts'
import { type AuthEndpointResult, callAuthEndpoint } from '#/server/http/auth-handler.ts'
import { displayClientAddress } from '#/server/http/client-address.ts'

// Every account action the UI offers, as server functions: the browser bundle carries no Better Auth client.
// Each one validates its input with Effect Schema and calls Better Auth in-process through its router
// (callAuthEndpoint), so rate limiting, the endpoint allowlist and the origin check apply exactly as they do on
// /api/auth/*, and Better Auth's cookies reach the browser on this response.

/** Why an action failed. `code` is Better Auth's error code, or RATE_LIMITED, NOT_FOUND or UNEXPECTED. */
export interface AuthFailure {
  readonly code: string
  /** Seconds until a rate-limited client may retry. */
  readonly retryAfter?: number
}

/** Expected failures are values, not exceptions: a wrong password is not a server error. */
export type AuthOutcome<T = null> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: AuthFailure }

const failure = (result: Extract<AuthEndpointResult, { ok: false }>): AuthOutcome<never> => ({
  ok: false,
  failure: {
    code:
      result.status === 429 ? 'RATE_LIMITED' : (result.code ?? (result.status === 404 ? 'NOT_FOUND' : 'UNEXPECTED')),
    ...(result.retryAfter === undefined ? {} : { retryAfter: result.retryAfter }),
  },
})

const done = (result: AuthEndpointResult): AuthOutcome => (result.ok ? { ok: true, value: null } : failure(result))

const Email = Schema.String.pipe(Schema.check(Schema.isMaxLength(254), Schema.isPattern(/^[^\s@]+@[^\s@]+$/)))
/** A password the account already has: only bounded, because older rules may have allowed other lengths. */
const CurrentPassword = Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(PASSWORD_MAX_LENGTH)))
const NewPassword = Schema.String.pipe(
  Schema.check(Schema.isMinLength(PASSWORD_MIN_LENGTH), Schema.isMaxLength(PASSWORD_MAX_LENGTH)),
)
const Token = Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(2048)))

// Nothing here may be cached: the answers depend on the session cookie.
const noStore = () => setResponseHeader('cache-control', 'private, no-store')

/** Whether /sign-up is available (AUTH_SIGN_UP). */
export const getSignUpPolicy = createServerFn({ method: 'GET' }).handler(() => {
  noStore()
  return { open: env.authSignUp === 'open' }
})

export const signIn = createServerFn({ method: 'POST' })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ email: Email, password: CurrentPassword })))
  .handler(async ({ data }) => done(await callAuthEndpoint('POST', '/sign-in/email', { body: data })))

export const signOut = createServerFn({ method: 'POST' }).handler(async () =>
  done(await callAuthEndpoint('POST', '/sign-out', { body: {} })),
)

/** Answers the same whether or not the email already has an account; the owner of an existing one gets a mail. */
export const signUp = createServerFn({ method: 'POST' })
  .validator(
    Schema.toStandardSchemaV1(
      Schema.Struct({
        name: Schema.String.pipe(Schema.check(Schema.isTrimmed(), Schema.isMinLength(1), Schema.isMaxLength(100))),
        email: Email,
        password: NewPassword,
      }),
    ),
  )
  .handler(async ({ data }) => done(await callAuthEndpoint('POST', '/sign-up/email', { body: data })))

/** Sends a new verification link if the address has an unverified account; answers the same otherwise. */
export const resendVerification = createServerFn({ method: 'POST' })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ email: Email })))
  .handler(async ({ data }) => done(await callAuthEndpoint('POST', '/send-verification-email', { body: data })))

export const verifyEmail = createServerFn({ method: 'POST' })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ token: Token })))
  .handler(async ({ data }) => done(await callAuthEndpoint('GET', '/verify-email', { query: { token: data.token } })))

/** Mails a reset link if the address has an account; answers the same otherwise. */
export const requestPasswordReset = createServerFn({ method: 'POST' })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ email: Email })))
  .handler(async ({ data }) => done(await callAuthEndpoint('POST', '/request-password-reset', { body: data })))

/** Sets the new password and signs out every session of the account (revokeSessionsOnPasswordReset). */
export const resetPassword = createServerFn({ method: 'POST' })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ token: Token, newPassword: NewPassword })))
  .handler(async ({ data }) => done(await callAuthEndpoint('POST', '/reset-password', { body: data })))

/** Always ends the account's other sessions; this one continues with a new token. */
export const changePassword = createServerFn({ method: 'POST' })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ currentPassword: CurrentPassword, newPassword: NewPassword })))
  .handler(async ({ data }) =>
    done(await callAuthEndpoint('POST', '/change-password', { body: { ...data, revokeOtherSessions: true } })),
  )

const ListedSession = Schema.Struct({
  id: Schema.String,
  token: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  ipAddress: Schema.NullishOr(Schema.String),
  userAgent: Schema.NullishOr(Schema.String),
})
const decodeSessions = Schema.decodeUnknownSync(Schema.Array(ListedSession))
const decodeCurrent = Schema.decodeUnknownSync(Schema.Struct({ session: Schema.Struct({ id: Schema.String }) }))

/** A session as the account page shows it. Tokens never leave the server. */
export interface SessionView {
  readonly id: string
  readonly current: boolean
  readonly createdAt: string
  readonly lastActiveAt: string
  /** An IPv4 address, or the IPv6 network Better Auth recorded, in CIDR notation (`2001:db8:1:2::/64`). */
  readonly ipAddress: string | null
  readonly userAgent: string | null
}

const listRaw = async () => {
  const listed = await callAuthEndpoint('GET', '/list-sessions')
  if (!listed.ok) return listed
  return { ok: true as const, sessions: decodeSessions(listed.body) }
}

/** The account's active sessions, newest activity first. Better Auth wants a recent sign-in (SESSION_NOT_FRESH). */
export const listSessions = createServerFn({ method: 'GET' }).handler(
  async (): Promise<AuthOutcome<ReadonlyArray<SessionView>>> => {
    noStore()
    const [listed, current] = await Promise.all([listRaw(), callAuthEndpoint('GET', '/get-session')])
    if (!listed.ok) return failure(listed)
    if (!current.ok) return failure(current)
    if (current.body === null) return { ok: false, failure: { code: 'UNAUTHORIZED' } }
    const currentId = decodeCurrent(current.body).session.id
    const sessions = listed.sessions
      .map((session) => ({
        id: session.id,
        current: session.id === currentId,
        createdAt: session.createdAt,
        lastActiveAt: session.updatedAt,
        ipAddress: session.ipAddress ? displayClientAddress(session.ipAddress) : null,
        userAgent: session.userAgent ?? null,
      }))
      .toSorted((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt))
    return { ok: true, value: sessions }
  },
)

/** Ends one session of the account, by id; Better Auth addresses sessions by token, which stays here. */
export const revokeSession = createServerFn({ method: 'POST' })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ id: Token })))
  .handler(async ({ data }): Promise<AuthOutcome> => {
    const listed = await listRaw()
    if (!listed.ok) return failure(listed)
    const session = listed.sessions.find((candidate) => candidate.id === data.id)
    // Already gone (or never the caller's): the outcome the user asked for.
    if (!session) return { ok: true, value: null }
    return done(await callAuthEndpoint('POST', '/revoke-session', { body: { token: session.token } }))
  })

export const revokeOtherSessions = createServerFn({ method: 'POST' }).handler(async () =>
  done(await callAuthEndpoint('POST', '/revoke-other-sessions', { body: {} })),
)

/** Ends every session of the account, this one included, and clears this browser's cookie. */
export const signOutEverywhere = createServerFn({ method: 'POST' }).handler(async (): Promise<AuthOutcome> => {
  const revoked = await callAuthEndpoint('POST', '/revoke-sessions', { body: {} })
  if (!revoked.ok) return failure(revoked)
  return done(await callAuthEndpoint('POST', '/sign-out', { body: {} }))
})

/** Deletes the account and its posts after checking the password. */
export const deleteAccount = createServerFn({ method: 'POST' })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ password: CurrentPassword })))
  .handler(async ({ data }) => done(await callAuthEndpoint('POST', '/delete-user', { body: data })))
