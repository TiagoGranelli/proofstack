// CharacterCount: the trimmed length against the limit, read out as characters, and flagged and announced only over
// it. The forms that use it test it again with their own limit (post-composer.test.tsx).
import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { CharacterCount, isTooLong } from '#/components/form/character-count.tsx'
import { renderInApp } from './test-utils.tsx'

const count = () => page.getByText(/^\d+\/10/)

describe('CharacterCount', () => {
  it('counts the trimmed text, so spaces around it never go over the limit', async () => {
    await renderInApp(<CharacterCount id="count" value={`  ${'x'.repeat(10)} \n`} max={10} />)
    await expect.element(count()).toHaveTextContent('10/10 characters.')
    await expect.element(count()).not.toHaveClass('text-destructive')
    await expect.element(page.getByText(/Over the/)).not.toBeInTheDocument()
  })

  it('flags text over the limit and says so in a polite live region', async () => {
    await renderInApp(<CharacterCount id="count" value={'x'.repeat(11)} max={10} />)
    await expect.element(count()).toHaveTextContent('11/10 characters. Over the 10-character limit.')
    await expect.element(count()).toHaveClass('text-destructive')
    await expect.element(page.getByText('Over the 10-character limit.')).toHaveAttribute('aria-live', 'polite')
  })

  it('applies the limit to the trimmed text', () => {
    expect(isTooLong(` ${'x'.repeat(10)} `, 10)).toBe(false)
    expect(isTooLong('x'.repeat(11), 10)).toBe(true)
  })
})
