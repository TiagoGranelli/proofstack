// Hidden check of the eval task bulk-delete-posts. .agents/evals/grade.sh copies it to tests/api/ after the agent has
// finished; it is never in the agent's checkout. It speaks HTTP to the handlers
// (webHandler), so it does not depend on how the agent typed the contract.
import { readFileSync } from 'node:fs'
import { describe, expect, it, onTestFinished } from 'vitest'
import { webHandler } from './harness.ts'

const APP = 'http://localhost:3000'
type Json = Record<string, unknown>

const api = () => {
  const { handler, dispose } = webHandler()
  onTestFinished(dispose)
  return async (who: 'alice' | 'bob' | 'none', method: string, path: string, body?: unknown) => {
    const response = await handler(
      new Request(`${APP}${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(who === 'none' ? {} : { cookie: `better-auth.session_token=${who}` }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    )
    const text = await response.text()
    return { status: response.status, json: (text ? JSON.parse(text) : null) as Json }
  }
}

type Send = ReturnType<typeof api>
const create = async (send: Send, who: 'alice' | 'bob', body: string) =>
  String((await send(who, 'POST', '/api/me/posts', { body })).json.id)
const myIds = async (send: Send, who: 'alice' | 'bob') =>
  ((await send(who, 'GET', '/api/me/posts')).json.items as Json[]).map((post) => post.id)

describe('eval: bulk-delete-posts', () => {
  it('deletes the listed posts of the signed-in author and counts them', async () => {
    const send = api()
    const [a, b, c] = [
      await create(send, 'alice', 'a'),
      await create(send, 'alice', 'b'),
      await create(send, 'alice', 'c'),
    ]
    const response = await send('alice', 'POST', '/api/me/posts/bulk-delete', { ids: [a, c] })
    expect(response.status).toBe(200)
    expect(response.json).toEqual({ deleted: 2 })
    expect(await myIds(send, 'alice')).toEqual([b])
  })

  it('deletes nothing and names every id that is not the author’s post', async () => {
    const send = api()
    const mine = await create(send, 'alice', 'mine')
    const theirs = await create(send, 'bob', 'theirs')
    const missing = '00000000-0000-4000-8000-000000000000'
    const response = await send('alice', 'POST', '/api/me/posts/bulk-delete', {
      ids: [theirs, mine, 'not-a-uuid', missing],
    })
    expect(response.status).toBe(404)
    expect(response.json).toMatchObject({ _tag: 'PostsNotFound', ids: [theirs, 'not-a-uuid', missing] })
    expect(await myIds(send, 'alice')).toEqual([mine])
    expect(await myIds(send, 'bob')).toEqual([theirs])
  })

  it.each([
    ['an empty list', []],
    ['51 ids', Array.from({ length: 51 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`)],
  ])('rejects %s with ValidationError', async (_, ids) => {
    const send = api()
    const response = await send('alice', 'POST', '/api/me/posts/bulk-delete', { ids })
    expect(response.status).toBe(400)
    expect(response.json._tag).toBe('ValidationError')
  })

  it('needs a session', async () => {
    const send = api()
    const response = await send('none', 'POST', '/api/me/posts/bulk-delete', { ids: ['x'] })
    expect(response.status).toBe(401)
    expect(response.json._tag).toBe('Unauthorized')
  })

  it('is in the contract with the new error and a session requirement', () => {
    const spec = JSON.parse(readFileSync('openapi.json', 'utf8')) as {
      paths: Record<string, Record<string, { security?: unknown[]; responses: Record<string, unknown> }>>
    }
    const operation = spec.paths['/api/me/posts/bulk-delete']?.post
    expect(operation?.responses).toHaveProperty('404')
    expect(operation?.security?.length).toBeGreaterThan(0)
    expect(readFileSync('src/lib/api-error.ts', 'utf8')).toContain('PostsNotFound')
  })
})
