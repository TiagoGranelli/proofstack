// SSR's side of the business API without a database: the in-process client (GET only) and the per-request session
// lookup, inside a real Start request context (`requestHandler`) with Better Auth's lookup stubbed. The db project
// counts the same composition in SQL statements (tests/db/ssr-session.test.ts).
import { requestHandler } from '@tanstack/react-start/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { myPostsCreate, systemHealth } from '#/sdk/sdk.gen.ts'
import { createInProcessApiClient } from '#/server/api/in-process-client.ts'
import { auth } from '#/server/auth.ts'
import { env } from '#/server/env.ts'
import { requestSession } from '#/server/http/request-session.ts'

afterEach(() => {
  vi.restoreAllMocks()
})

/** Runs `work` as Start runs one request with `cookie`, and returns what `work` returned. */
const serve = async <T>(work: () => Promise<T>, cookie = 'session=a'): Promise<T> => {
  const results: T[] = []
  await requestHandler(async () => {
    results.push(await work())
    return new Response(null, { status: 204 })
  })(new Request(`${env.appUrl}/dashboard`, { headers: { cookie } }), {})
  return results[0]!
}

const lookups = () => {
  const getSession = vi.spyOn(auth.api, 'getSession').mockResolvedValue(null)
  return () => getSession.mock.calls.map(([options]) => new Headers(options?.headers).get('cookie'))
}

describe('requestSession', () => {
  it('asks Better Auth once per request and cookie, and every time outside a request', async () => {
    const cookies = lookups()
    await serve(async () => {
      await Promise.all([
        requestSession(new Headers({ cookie: 'session=a' })),
        requestSession(new Headers({ cookie: 'session=a' })),
      ])
      await requestSession(new Headers({ cookie: 'session=b' }))
      await requestSession(new Headers())
    })
    await serve(() => requestSession(new Headers({ cookie: 'session=a' })))
    await requestSession(new Headers({ cookie: 'session=a' }))
    await requestSession(new Headers({ cookie: 'session=a' }))
    expect(cookies()).toEqual(['session=a', 'session=b', null, 'session=a', 'session=a', 'session=a'])
  })
})

describe('the in-process API client', () => {
  it('answers GET from the Effect handler', async () => {
    const health = await serve(() => systemHealth({ client: createInProcessApiClient() }))
    expect(health.data).toEqual({ status: 'ok' })
  })

  it('refuses anything but GET before the handler runs', async () => {
    const { error, response } = await serve(() =>
      myPostsCreate({ client: createInProcessApiClient(), body: { body: 'never sent' } }),
    )
    expect(response).toBeUndefined()
    // The SDK hands a thrown fetch back as `error`, whatever its declared error bodies are.
    const thrown: unknown = error
    expect(thrown instanceof Error && thrown.message).toMatch(/only sends GET \(got POST \/api\/me\/posts\)/)
  })
})
