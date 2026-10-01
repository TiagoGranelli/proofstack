// The id brands of src/contract/ids.ts exist only for the compiler, so this file is checked by `pnpm typecheck`:
// each `@ts-expect-error` below fails the typecheck the day the line under it starts to compile.
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { type PostId, UserId } from '#/contract/ids.ts'
import { post } from '#/server/db/schema/posts.ts'

describe('id brands', () => {
  it('refuse a user id where a post id is expected, in a value and in a query', () => {
    const author = UserId.make('user-1')
    // @ts-expect-error a user's id is not a post's id: the mix-up the brands exist to refuse
    const mixedUp: PostId = author
    // @ts-expect-error the same mix-up in a WHERE clause: post.id compared with a user's id
    const condition = eq(post.id, author)
    // At run time both are the same string and the query is built; only the compiler tells them apart.
    expect(mixedUp).toBe('user-1')
    expect(condition).toBeDefined()
  })

  it('accept a plain string only through the brand', () => {
    // @ts-expect-error a string that did not go through UserId.make or a decoded schema
    const unbranded: UserId = 'user-1'
    expect(UserId.make(unbranded)).toBe('user-1')
  })
})
