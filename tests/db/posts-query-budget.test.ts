// Query budgets of the example's repository (see query-budget.test.ts): a list sends one statement for 1 row or 50.
import { Effect, Layer } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PageCursor, PostPage } from '#/contract/posts.ts'
import { pool } from '#/server/db/client.ts'
import * as schema from '#/server/db/schema/index.ts'
import { PostsRepo } from '#/server/posts/repo.ts'
import { createAccount, recordingDatabase, recordingDb, withBudget as budget } from './helpers.ts'

afterAll(() => pool.end())

const repoLayer = PostsRepo.layer.pipe(Layer.provide(recordingDatabase))

type Repo = typeof PostsRepo.Service
/** Runs one repository call and checks it sent exactly `budget` statements. */
const withBudget = <A, E>(what: string, n: number, call: (repo: Repo) => Effect.Effect<A, E>) =>
  budget(
    what,
    n,
    Effect.gen(function* () {
      return yield* call(yield* PostsRepo)
    }).pipe(Effect.provide(repoLayer)),
  )

type Author = { id: string; name: string }
let few: Author
let many: Author
beforeAll(async () => {
  const [a, b] = await Promise.all([createAccount('budget-few'), createAccount('budget-many')])
  few = a
  many = b
  await recordingDb.insert(schema.post).values({ authorId: few.id, body: 'the only post' })
  await recordingDb
    .insert(schema.post)
    .values(Array.from({ length: 50 }, (_, i) => ({ authorId: many.id, body: `post ${i}` })))
})

const lastKey = (page: PostPage): PageCursor | undefined => page.nextCursor ?? undefined

describe('PostsRepo', () => {
  it('lists one page in one statement, with 1 post or 50, with or without a cursor', async () => {
    const one = await withBudget('listByAuthor (1 post)', 1, (repo) => repo.listByAuthor(few, { limit: 20 }))
    expect(one.items).toHaveLength(1)
    const full = await withBudget('listByAuthor (50 posts)', 1, (repo) => repo.listByAuthor(many, { limit: 50 }))
    expect(full.items).toHaveLength(50)
    const first = await withBudget('listByAuthor (page 1 of 50)', 1, (repo) => repo.listByAuthor(many, { limit: 20 }))
    const next = await withBudget('listByAuthor (page 2 of 50)', 1, (repo) =>
      repo.listByAuthor(many, { limit: 20, cursor: lastKey(first) }),
    )
    expect(next.items).toHaveLength(20)

    // The public list joins the author's name in the same statement, however many authors a page holds.
    const small = await withBudget('listPublic (limit 1)', 1, (repo) => repo.listPublic({ limit: 1 }))
    const large = await withBudget('listPublic (limit 50)', 1, (repo) =>
      repo.listPublic({ limit: 50, cursor: lastKey(small) }),
    )
    expect(new Set(large.items.map((post) => post.authorName)).size).toBeGreaterThan(1)
  })

  it('creates, edits and deletes in one statement each, and edits move updatedAt', async () => {
    const created = await withBudget('create', 1, (repo) => repo.create(few, 'budgeted'))
    // Postgres generated a time-ordered id (the column default, uuidv7()).
    expect(created.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    const updated = await withBudget('update', 1, (repo) => repo.update(few, created.id, 'budgeted, edited'))
    expect(updated?.createdAt).toBe(created.createdAt)
    expect(Date.parse(updated!.updatedAt)).toBeGreaterThan(Date.parse(created.updatedAt))
    // Another author's post: the same single statement finds nothing.
    expect(await withBudget('update (not the owner)', 1, (repo) => repo.update(many, created.id, 'x'))).toBeUndefined()
    // A malformed id never reaches Postgres.
    expect(await withBudget('update (malformed id)', 0, (repo) => repo.update(few, 'not-a-uuid', 'x'))).toBeUndefined()
    expect(await withBudget('remove (malformed id)', 0, (repo) => repo.remove(few, 'not-a-uuid'))).toBe(false)
    expect(await withBudget('remove', 1, (repo) => repo.remove(few, created.id))).toBe(true)
    expect(await withBudget('remove (gone)', 1, (repo) => repo.remove(few, created.id))).toBe(false)
  })
})
