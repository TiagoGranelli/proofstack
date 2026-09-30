// countWords: examples for the cases people type, and properties for any text.
import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { countWords } from '../../src/lib/count-words.ts'

describe('countWords', () => {
  it.each<[string, string, number]>([
    ['an empty text', '', 0],
    ['only whitespace', ' \n\t ', 0],
    ['one word', 'hello', 1],
    ['words around extra spaces and line breaks', '  two\n\nwords  ', 2],
    ['punctuation as part of its word', "don't e-mail me, please.", 4],
  ])('counts %s', (_, text, expected) => {
    expect(countWords(text)).toBe(expected)
  })

  it('counts two texts joined by whitespace as the sum of both', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (first, second) => {
        expect(countWords(`${first} ${second}`)).toBe(countWords(first) + countWords(second))
      }),
    )
  })

  it('never counts more words than there are characters', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), (text) => {
        expect(countWords(text)).toBeLessThanOrEqual(text.length)
      }),
    )
  })
})
