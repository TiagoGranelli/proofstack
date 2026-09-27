// U+0000 never reaches Postgres (src/contract/stored-text.ts): every user-supplied string that is stored or looked
// up refuses it with a message and the path of its field, on the server and in the forms that share the schemas.
import { Schema } from 'effect'
import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { PostInput } from '#/contract/post-input.ts'
import { isFreeOfNul } from '#/contract/stored-text.ts'
import { SessionInput, SignInInput, SignUpInput, TokenInput } from '#/lib/account-input.ts'

const NUL_MESSAGE = 'Remove the invisible NUL character (U+0000) from the text.'

/** The issues a server function's validator or a form (both Standard Schema) reports for `input`. */
const issuesOf = (schema: Parameters<typeof Schema.toStandardSchemaV1>[0], input: unknown) => {
  const validation = Schema.toStandardSchemaV1(schema)['~standard'].validate(input)
  if (validation instanceof Promise) throw new Error('the account and post inputs validate synchronously')
  return (validation.issues ?? []).map(({ path, message }) => ({ path: path?.map(String), message }))
}

const Text = Schema.String.check(isFreeOfNul)

describe('isFreeOfNul', () => {
  it('refuses a NUL anywhere, and nothing else', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (before, after) => {
        expect(Schema.is(Text)(`${before}\u0000${after}`)).toBe(false)
        const clean = `${before}${after}`.replaceAll('\u0000', '')
        expect(Schema.is(Text)(clean)).toBe(true)
      }),
    )
  })
})

describe('the inputs that reach Postgres', () => {
  const withNul = 'ada\u0000@example.test'

  it('refuses a NUL in a post body', () => {
    expect(issuesOf(PostInput, { body: 'before\u0000after' })).toEqual([{ path: ['body'], message: NUL_MESSAGE }])
  })

  it('refuses a NUL in the name and email of a sign-up, and in the email of a sign-in', () => {
    const signUp = { name: 'Ada\u0000', email: withNul, password: 'a long enough password' }
    expect(issuesOf(SignUpInput, signUp)).toEqual(
      expect.arrayContaining([
        { path: ['name'], message: NUL_MESSAGE },
        { path: ['email'], message: NUL_MESSAGE },
      ]),
    )
    expect(issuesOf(SignInInput, { email: withNul, password: 'secret' })).toEqual([
      { path: ['email'], message: NUL_MESSAGE },
    ])
  })

  it('refuses a NUL in a token or a session id, which queries look up', () => {
    expect(issuesOf(TokenInput, { token: 'abc\u0000' })).toEqual([{ path: ['token'], message: NUL_MESSAGE }])
    expect(issuesOf(SessionInput, { id: '\u0000' })).toEqual([{ path: ['id'], message: NUL_MESSAGE }])
  })
})
