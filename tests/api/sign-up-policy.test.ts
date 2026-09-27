// The default sign-up policy (AUTH_SIGN_UP unset = closed, ADR 0003) at Better Auth's router: the one that
// /api/auth/* and every account server function (callAuthEndpoint in src/server/http/auth-handler.ts) go
// through. verify:app checks the same end to end, through the signUp server function on the closed server
// (tests/integration/auth-sign-up.test.ts); this is the database-free check in `pnpm check`. Answering 404
// happens before the database is touched, so the api project's placeholder DATABASE_URL is enough.
import { describe, expect, it } from 'vitest'
import { auth } from '#/server/auth.ts'
import { env } from '#/server/env.ts'

const signUp = (path: string) =>
  auth.handler(
    new Request(`${env.appUrl}/api/auth${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: env.appUrl },
      body: JSON.stringify({ name: 'Nobody', email: 'nobody@example.test', password: 'a-long-enough-password' }),
    }),
  )

describe('closed sign-up (the default)', () => {
  it('is the policy when AUTH_SIGN_UP is unset', () => {
    expect(env.authSignUp).toBe('closed')
  })

  it('answers 404 to a sign-up through Better Auth, before any account is created', async () => {
    expect((await signUp('/sign-up/email')).status).toBe(404)
  })

  it('leaves no other way to sign up by path variants', async () => {
    for (const path of ['/sign-up/email/', '/sign-up//email', '/SIGN-UP/EMAIL', '/sign-up'])
      expect((await signUp(path)).status, path).toBe(404)
  })
})
