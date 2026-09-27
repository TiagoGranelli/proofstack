// THEME_SCRIPT runs in <head> before the first paint, as a string: here it runs in a context of its own, against a
// stand-in document and storage, the only two things it touches.
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { THEME_SCRIPT } from '#/lib/theme.ts'

/** Runs the script with `stored` as the saved choice (storage that throws with `blocked`); returns `data-theme`. */
const run = (stored: string | null, options: { blocked?: boolean } = {}) => {
  const documentElement = { dataset: {} as Record<string, string> }
  const localStorage = {
    getItem: (key: string) => {
      if (options.blocked) throw new Error('SecurityError: storage is disabled')
      return key === 'theme' ? stored : null
    },
  }
  runInNewContext(THEME_SCRIPT, { document: { documentElement }, localStorage })
  return documentElement.dataset.theme
}

describe('THEME_SCRIPT', () => {
  it.each(['light', 'dark'])('applies a stored %s choice to <html data-theme>', (choice) => {
    expect(run(choice)).toBe(choice)
  })

  it.each<[string, string | null]>([
    ['nothing stored', null],
    ['an unknown value', 'solarized'],
    ['markup', '"><script>alert(1)</script>'],
  ])('leaves the theme to the system with %s', (_, stored) => {
    expect(run(stored)).toBeUndefined()
  })

  it('leaves the theme to the system when storage is blocked, without throwing', () => {
    expect(run('dark', { blocked: true })).toBeUndefined()
  })

  it('stays small enough to inline in every page', () => {
    expect(THEME_SCRIPT.length).toBeLessThan(160)
  })
})
