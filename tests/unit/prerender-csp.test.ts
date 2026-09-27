import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { inlineSourceHashes } from '#/server/nitro/prerender-csp.ts'

const hash = (text: string) => `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`

describe('inlineSourceHashes', () => {
  it('hashes inline scripts and styles exactly as written, skipping external scripts', () => {
    const html =
      '<!DOCTYPE html><html><head><style>a{color:red}</style><script src="/x.js"></script></head>' +
      '<body><script nonce="n">self.$_TSR = {"a":"</b>"}</script><script>\r\nlet é = 1</script></body></html>'
    expect(inlineSourceHashes(html)).toEqual({
      // The HTML parser normalizes CRLF to LF before the browser hashes the text.
      script: [hash('self.$_TSR = {"a":"</b>"}'), hash('\nlet é = 1')],
      style: [hash('a{color:red}')],
    })
  })

  it('refuses inline attributes that no hash can allow', () => {
    expect(() => inlineSourceHashes('<p style="color:red">x</p>')).toThrow(/inline `style` attribute/)
    expect(() => inlineSourceHashes('<button onclick="go()">x</button>')).toThrow(/inline `onclick` attribute/)
  })
})
