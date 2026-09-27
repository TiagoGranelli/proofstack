// Build time only: vite.config.ts calls this from Nitro's `prerender:generate` hook for every prerendered
// HTML page. It never runs in the server bundle.
import { createHash } from 'node:crypto'
import { type DefaultTreeAdapterTypes, parse } from 'parse5'

type ParentNode = DefaultTreeAdapterTypes.ParentNode
type Element = DefaultTreeAdapterTypes.Element

const sha256 = (text: string) => `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`

const isElement = (node: DefaultTreeAdapterTypes.Node): node is Element => 'tagName' in node

const textOf = (element: Element) =>
  element.childNodes.map((child) => ('value' in child && child.nodeName === '#text' ? child.value : '')).join('')

/**
 * CSP hash sources for the inline scripts and styles of a static HTML page. parse5 is a WHATWG-conformant
 * parser, so each hash covers exactly the text a browser hashes (raw text, newlines normalized).
 * Attribute-level inline code (`on*` handlers, `style` attributes) cannot be allowed by a hash without
 * 'unsafe-hashes', so it fails the build instead of shipping a page that breaks under the policy.
 */
export const inlineSourceHashes = (html: string) => {
  const script = new Set<string>()
  const style = new Set<string>()
  const visit = (parent: ParentNode) => {
    for (const node of parent.childNodes) {
      if (!isElement(node)) continue
      for (const { name } of node.attrs) {
        if (name === 'style' || name.startsWith('on'))
          throw new Error(`prerendered HTML has an inline \`${name}\` attribute on <${node.tagName}>; CSP forbids it`)
      }
      if (node.tagName === 'script' && !node.attrs.some((attr) => attr.name === 'src')) script.add(sha256(textOf(node)))
      if (node.tagName === 'style') style.add(sha256(textOf(node)))
      visit(node)
      if (node.tagName === 'template') visit((node as DefaultTreeAdapterTypes.Template).content)
    }
  }
  visit(parse(html))
  return { script: [...script], style: [...style] }
}
