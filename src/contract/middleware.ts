import { Context } from 'effect'
import { HttpApiMiddleware, HttpApiSecurity, OpenApi } from 'effect/unstable/httpapi'
import { Unauthorized, ValidationError } from './errors.ts'

interface SessionUser {
  readonly id: string
  readonly name: string
  readonly email: string
}

export class CurrentUser extends Context.Service<CurrentUser, SessionUser>()('proofstack/CurrentUser') {}

const SESSION_COOKIE = 'better-auth.session_token'

/**
 * Resolves the Better Auth session cookie into `CurrentUser`; fails with 401 otherwise.
 *
 * Better Auth names the cookie `__Secure-better-auth.session_token` when APP_URL is https and
 * `better-auth.session_token` otherwise, so the contract declares both as alternatives. Browsers send
 * the cookie by themselves; the implementation hands the request headers to Better Auth, which
 * verifies the signature and looks up the session.
 */
export class Authentication extends HttpApiMiddleware.Service<Authentication, { provides: CurrentUser }>()(
  'proofstack/Authentication',
  {
    error: Unauthorized,
    security: {
      sessionCookie: HttpApiSecurity.apiKey({ in: 'cookie', key: SESSION_COOKIE }).pipe(
        HttpApiSecurity.annotate(OpenApi.Description, 'Better Auth session cookie over http (development).'),
      ),
      secureSessionCookie: HttpApiSecurity.apiKey({ in: 'cookie', key: `__Secure-${SESSION_COOKIE}` }).pipe(
        HttpApiSecurity.annotate(OpenApi.Description, 'Better Auth session cookie when APP_URL is https.'),
      ),
    },
  },
) {}

/**
 * Turns request decoding failures (path, headers, query, body) into a documented 400 body instead of
 * Effect's empty default. Applied only to endpoints that take input, so input-less endpoints do not
 * document a 400 they cannot return.
 */
export class RequestValidation extends HttpApiMiddleware.Service<RequestValidation>()('proofstack/RequestValidation', {
  error: ValidationError,
}) {}
