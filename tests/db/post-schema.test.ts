// The post table on real Postgres: the plans behind the keyset lists, the body CHECK constraint (a backstop that
// never rejects what the API accepts) and updated_at from the database clock. Seeded rows are dated in 2000, so
// they sit below every post the other db files create "now" in the public feed.
import { drizzle } from 'drizzle-orm/node-postgres'
import { Effect, Exit, Layer, Schema } from 'effect'
import * as fc from 'fast-check'
import type { DatabaseError } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { POST_MAX_LENGTH } from '#/contract/limits.ts'
import { PostInput } from '#/contract/post-input.ts'
import { Database, pool } from '#/server/db/client.ts'
import * as schema from '#/server/db/schema/index.ts'
import { PostsRepo } from '#/server/posts/repo.ts'
import { createAccount } from './helpers.ts'

afterAll(() => pool.end())

const logged: Array<{ query: string; params: unknown[] }> = []
const recordingDb = drizzle({
  client: pool,
  schema,
  logger: { logQuery: (query, params) => void logged.push({ query, params }) },
})
const repoLayer = PostsRepo.layer.pipe(Layer.provide(Layer.succeed(Database, recordingDb)))
/** The statement one repository call sends. */
const statementOf = async <A>(call: (repo: typeof PostsRepo.Service) => Effect.Effect<A, unknown>) => {
  logged.length = 0
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* call(yield* PostsRepo)
    }).pipe(Effect.provide(repoLayer)),
  )
  expect(logged).toHaveLength(1)
  return { result, ...logged[0]! }
}

type PlanNode = { 'Node Type': string; 'Index Name'?: string; 'Scan Direction'?: string; Plans?: PlanNode[] }
const nodesOf = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap((child) => nodesOf(child))]
const planOf = async (statement: { query: string; params: unknown[] }) => {
  const { rows } = await pool.query<{ 'QUERY PLAN': [{ Plan: PlanNode }] }>(
    `explain (format json) ${statement.query}`,
    statement.params,
  )
  return nodesOf(rows[0]!['QUERY PLAN'][0].Plan)
}

let author: { id: string; name: string }
beforeAll(async () => {
  author = await createAccount('schema')
  // 10,000 posts one second apart by 100 authors (`author` is the first), so the planner sees a table and an
  // author worth an index.
  const run = crypto.randomUUID()
  await pool.query(
    `insert into "user" (id, name, email, email_verified)
       select $1 || '-' || n, 'Plan ' || n, $1 || '-' || n || '@example.test', true from generate_series(1, 99) n`,
    [run],
  )
  await pool.query(
    `insert into post (author_id, body, created_at, updated_at)
       select case when g % 100 = 0 then $1 else $2 || '-' || (g % 100) end, 'seeded ' || g, t, t
       from (select g, timestamptz '2000-01-01' + make_interval(secs => g) as t from generate_series(1, 10000) g) s`,
    [author.id, run],
  )
  await pool.query('analyze post')
})

describe('keyset list plans', () => {
  it('reads each list backward from its ascending index, without a Sort, on the first page and a deep one', async () => {
    const first = await statementOf((repo) => repo.listByAuthor(author, { limit: 20 }))
    const deep = await statementOf((repo) =>
      repo.listByAuthor(author, { limit: 20, cursor: first.result.nextCursor ?? undefined }),
    )
    const publicDeep = await statementOf((repo) =>
      repo.listPublic({ limit: 20, cursor: deep.result.nextCursor ?? undefined }),
    )
    for (const [statement, index] of [
      [first, 'post_author_keyset_idx'],
      [deep, 'post_author_keyset_idx'],
      [publicDeep, 'post_keyset_idx'],
    ] as const) {
      const nodes = await planOf(statement)
      const summary = nodes.map((node) => `${node['Node Type']} ${node['Index Name'] ?? ''}`).join(', ')
      expect(
        nodes.some((node) => node['Node Type'] === 'Sort'),
        summary,
      ).toBe(false)
      expect(
        nodes.find((node) => node['Index Name'] === index),
        summary,
      ).toMatchObject({ 'Scan Direction': 'Backward' })
    }
    // The author's posts are every hundredth; the deep public page starts right below their second page.
    expect(deep.result.items.map((post) => post.body).slice(0, 2)).toEqual(['seeded 8000', 'seeded 7900'])
    expect(publicDeep.result.items[0]?.body).toBe('seeded 6099')
  })
})

const insert = (body: string) =>
  pool.query(`insert into post (author_id, body, created_at) values ($1, $2, timestamptz '2000-01-01')`, [
    author.id,
    body,
  ])
const sqlState = async (body: string) =>
  insert(body).then(
    () => 'ok',
    (error: unknown) => (error as DatabaseError).code,
  )

const acceptedByApi = (body: string) => Exit.isSuccess(Schema.decodeExit(PostInput)({ body }))

describe('post_body_check', () => {
  it.each([
    ['empty', ''],
    [`longer than ${POST_MAX_LENGTH} characters`, 'a'.repeat(POST_MAX_LENGTH + 1)],
    ['a leading space', ' post'],
    ['a trailing space', 'post '],
  ])('refuses a body that is %s with check_violation (23514)', async (_, body) => {
    expect(await sqlState(body)).toBe('23514')
  })

  it(`admits ${POST_MAX_LENGTH} characters, counted in code points: an emoji is one`, async () => {
    expect(await sqlState('a'.repeat(POST_MAX_LENGTH))).toBe('ok')
    // The API counts UTF-16 units and stops at 140 of these; the database would take 280.
    expect(await sqlState('😀'.repeat(POST_MAX_LENGTH))).toBe('ok')
    expect(await sqlState('😀'.repeat(POST_MAX_LENGTH + 1))).toBe('23514')
  })

  it('never refuses a body the API accepts', async () => {
    const bodies = fc
      .oneof(
        fc.string({ maxLength: POST_MAX_LENGTH + 2 }),
        fc.string({ unit: 'grapheme', maxLength: 150 }),
        fc.string({ unit: fc.constantFrom(' ', '\t', '\n', ' ', ' ', 'a', '😀'), maxLength: 290 }),
      )
      // Postgres text cannot hold NUL (22021), whatever the constraint says.
      .map((body) => body.replaceAll('\u0000', ''))
      .filter((body) => acceptedByApi(body))
    await fc.assert(
      fc.asyncProperty(bodies, async (body) => {
        expect(await sqlState(body)).toBe('ok')
      }),
      { numRuns: 300 },
    )
  })
})

describe('updated_at', () => {
  it('comes from the database clock on every edit, like created_at', async () => {
    const created = await statementOf((repo) => repo.create(author, 'clock'))
    const edit = await statementOf((repo) => repo.update(author, created.result.id, 'clock, edited'))
    expect(edit.query).toMatch(/"updated_at" = now\(\)/)
    expect(edit.params.some((param) => param instanceof Date)).toBe(false)
    const { rows } = await pool.query<{ ordered: boolean }>(
      'select updated_at >= created_at as ordered from post where id = $1',
      [created.result.id],
    )
    expect(rows).toEqual([{ ordered: true }])
  })
})
