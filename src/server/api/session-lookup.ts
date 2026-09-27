import '@tanstack/react-start/server-only'
import { Context, type Effect } from 'effect'
import type { CurrentUser } from '#/contract/middleware.ts'

/**
 * Finds the signed-in user of a request's session cookie, or null when there is none or it is not valid. The
 * Authentication middleware (./middleware.ts) asks through this service, so it never imports Better Auth and
 * tests/api can fake the session store. The live Layer is wired in ./web-handler.ts; a lookup that fails (the
 * database is gone) is a defect, so the request answers 500.
 */
export class SessionLookup extends Context.Service<
  SessionLookup,
  { readonly userOf: (headers: Headers) => Effect.Effect<CurrentUser['Service'] | null> }
>()('app/SessionLookup') {}
