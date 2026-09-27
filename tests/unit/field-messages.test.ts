// What a form field shows and announces (src/components/form/field-messages.ts): the first message among the
// validators' results, and the ids its input is described by.
import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { describedBy, fieldErrorMessage } from '#/components/form/field-messages.ts'

describe('fieldErrorMessage', () => {
  it('takes the first Standard Schema issue or non-empty string, skipping validators that passed', () => {
    expect(fieldErrorMessage([undefined, { message: 'Enter your email address.' }, 'later'])).toBe(
      'Enter your email address.',
    )
    expect(fieldErrorMessage(['', null, 'Use at most 280 characters.'])).toBe('Use at most 280 characters.')
  })

  it('has no message when no result carries one', () => {
    expect(fieldErrorMessage([])).toBeUndefined()
    expect(fieldErrorMessage([undefined, '', null, 42, { path: ['body'] }, { message: 7 }])).toBeUndefined()
  })

  it('returns one of the messages it was given, for any mix of results', () => {
    const result = fc.oneof(
      fc.string(),
      fc.record({ message: fc.oneof(fc.string(), fc.integer()) }),
      fc.constantFrom(undefined, null, 0, false),
    )
    fc.assert(
      fc.property(fc.array(result), (errors) => {
        const message = fieldErrorMessage(errors)
        const candidates = errors.flatMap((error) => {
          if (typeof error === 'string') return [error]
          return typeof error === 'object' && error !== null && typeof error.message === 'string' ? [error.message] : []
        })
        expect(message === undefined || candidates.includes(message)).toBe(true)
      }),
    )
  })
})

describe('describedBy', () => {
  it('joins the ids that apply', () => {
    expect(describedBy('body-hint', false, 'body-error')).toBe('body-hint body-error')
  })

  it('is undefined when none applies, so the attribute is left out', () => {
    expect(describedBy()).toBeUndefined()
    expect(describedBy(undefined, null, false, '')).toBeUndefined()
  })
})
