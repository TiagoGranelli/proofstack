// flashMessage: the one-time message a redirect leaves in history state. History state is not trusted input: only
// a known code shows anything.
import { describe, expect, it } from 'vitest'
import { FLASH_MESSAGES, flashMessage } from '#/lib/flash.ts'

describe('flashMessage', () => {
  it.each(Object.entries(FLASH_MESSAGES))('shows the message of %s', (code, message) => {
    expect(flashMessage(code)).toBe(message)
  })

  it.each([undefined, null, '', 'SIGNED-OUT', 'toString', '__proto__', '<b>hi</b>', 42, { flash: 'signed-out' }])(
    'shows nothing for %j',
    (flash) => {
      expect(flashMessage(flash)).toBeUndefined()
    },
  )
})
