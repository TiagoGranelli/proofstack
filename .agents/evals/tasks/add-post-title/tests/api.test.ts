// Hidden check of the eval task add-post-title. .agents/evals/grade.sh copies it to tests/api/ after the agent has
// finished; it is never in the agent's checkout. It speaks HTTP to the handlers
// (webHandler), so it does not depend on how the agent typed the contract.
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it, onTestFinished } from 'vitest'
import * as limits from '#/contract/limits.ts'
import { webHandler } from './harness.ts'

const APP = 'http://localhost:3000'

const api = () => {
  const { handler, dispose } = webHandler()
  onTestFinished(dispose)
  return async (method: string, path: string, body?: unknown) => {
    const response = await handler(
      new Request(`${APP}${path}`, {
        method,
        headers: { cookie: 'better-auth.session_token=alice', 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    )
    const text = await response.text()
    return { status: response.status, json: (text ? JSON.parse(text) : null) as Record<string, unknown> }
  }
}

describe('eval: add-post-title', () => {
  it('exports the title limit next to the body limit', () => {
    expect((limits as Record<string, unknown>).POST_TITLE_MAX_LENGTH).toBe(80)
  })

  it('creates, lists and updates a post with a title', async () => {
    const send = api()
    const created = await send('POST', '/api/me/posts', { body: 'Body text', title: 'A title' })
    expect(created.status).toBe(201)
    expect(created.json).toMatchObject({ body: 'Body text', title: 'A title' })

    const list = await send('GET', '/api/me/posts')
    expect((list.json.items as unknown[])[0]).toMatchObject({ title: 'A title' })
    const publicList = await send('GET', '/api/posts')
    expect((publicList.json.items as unknown[])[0]).toMatchObject({ title: 'A title' })

    const updated = await send('PATCH', `/api/me/posts/${String(created.json.id)}`, {
      body: 'Body text',
      title: 'Better title',
    })
    expect(updated.status).toBe(200)
    expect(updated.json).toMatchObject({ title: 'Better title' })
  })

  it('answers title null for a post without one, and an update without a title removes it', async () => {
    const send = api()
    const plain = await send('POST', '/api/me/posts', { body: 'No title here' })
    expect(plain.status).toBe(201)
    expect(plain.json.title).toBeNull()

    const titled = await send('POST', '/api/me/posts', { body: 'Titled', title: 'Soon gone' })
    const updated = await send('PATCH', `/api/me/posts/${String(titled.json.id)}`, { body: 'Titled' })
    expect(updated.status).toBe(200)
    expect(updated.json.title).toBeNull()
  })

  it.each([
    ['one character over the limit', 'x'.repeat(81)],
    ['an empty title', ''],
    ['an untrimmed title', ' padded '],
  ])('rejects %s with ValidationError', async (_, title) => {
    const send = api()
    const response = await send('POST', '/api/me/posts', { body: 'Body', title })
    expect(response.status).toBe(400)
    expect(response.json._tag).toBe('ValidationError')
  })

  it('accepts a title of exactly 80 characters', async () => {
    const send = api()
    const response = await send('POST', '/api/me/posts', { body: 'Body', title: 'x'.repeat(80) })
    expect(response.status).toBe(201)
  })

  it('documents the field in openapi.json and adds a migration for the column', () => {
    const spec = JSON.parse(readFileSync('openapi.json', 'utf8')) as {
      components: { schemas: Record<string, { properties?: Record<string, unknown>; required?: string[] }> }
    }
    expect(spec.components.schemas.Post?.properties).toHaveProperty('title')
    expect(spec.components.schemas.PostInput?.properties).toHaveProperty('title')
    expect(spec.components.schemas.PostInput?.required ?? []).not.toContain('title')

    const migrations = readdirSync('drizzle').filter((file) => /^\d{4}_.*\.sql$/.test(file) && file > '0004_z')
    const sql = migrations.map((file) => readFileSync(`drizzle/${file}`, 'utf8')).join('\n')
    expect(sql).toMatch(/ADD COLUMN "title"/i)
  })
})
