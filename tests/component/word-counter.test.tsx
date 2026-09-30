// WordCounter in Chromium: the count follows what is typed, reads in the singular for one word, and Clear empties
// the field.
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'
import { WordCounter } from '../../src/components/word-counter.tsx'

const field = () => page.getByRole('textbox', { name: 'Your text' })
const count = () => page.getByRole('status')

describe('WordCounter', () => {
  it('starts empty at zero words', async () => {
    await render(<WordCounter />)
    await expect.element(field()).toHaveValue('')
    await expect.element(count()).toHaveTextContent('0 words')
  })

  it('counts the words as they are typed, in the singular for one', async () => {
    await render(<WordCounter />)
    await field().fill('hello')
    await expect.element(count()).toHaveTextContent('1 word')
    await field().fill('hello there, world')
    await expect.element(count()).toHaveTextContent('3 words')
  })

  it('empties the field and the count with Clear', async () => {
    await render(<WordCounter />)
    await field().fill('some words here')
    await page.getByRole('button', { name: 'Clear' }).click()
    await expect.element(field()).toHaveValue('')
    await expect.element(count()).toHaveTextContent('0 words')
  })
})
