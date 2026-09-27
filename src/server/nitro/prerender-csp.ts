// Build time only: vite.config.ts calls this from Nitro's `prerender:generate` hook for every prerendered
// HTML page. It never runs in the server bundle.
import { createHash } from 'node:crypto'
import { type DefaultTreeAdapterTypes, defaultTreeAdapter, parse } from 'parse5'

type ParentNode = DefaultTreeAdapterTypes.ParentNode
type Element = DefaultTreeAdapterTypes.Element

const sha256 = (text: string) => `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`

const isElement = (node: DefaultTreeAdapterTypes.Node): node is Element => 'tagName' in node

const textOf = (element: Element) =>
  element.childNodes.map((child) => (defaultTreeAdapter.isTextNode(child) ? child.value : '')).join('')

/** The elements under `parent` in document order, the contents of `<template>` elements included. */
function* elementsOf(parent: ParentNode): Generator<Element> {
  for (const node of parent.childNodes) {
    if (!isElement(node)) continue
    yield node
    yield* elementsOf(node)
    if (node.tagName === 'template') yield* elementsOf((node as DefaultTreeAdapterTypes.Template).content)
  }
}

/**
 * Attribute-level inline code (`on*` handlers, `style` attributes) cannot be allowed by a hash without
 * 'unsafe-hashes', so it fails the build instead of shipping a page that breaks under the policy.
 */
const rejectInlineAttributes = (element: Element) => {
  const inline = element.attrs.find(({ name }) => name === 'style' || name.startsWith('on'))
  if (inline)
    throw new Error(
      `prerendered HTML has an inline \`${inline.name}\` attribute on <${element.tagName}>; CSP forbids it`,
    )
}

/**
 * CSP hash sources for the inline scripts and styles of a static HTML page. parse5 is a WHATWG-conformant
 * parser, so each hash covers exactly the text a browser hashes (raw text, newlines normalized).
 */
export const inlineSourceHashes = (html: string): { script: string[]; style: string[] } => {
  const script = new Set<string>()
  const style = new Set<string>()
  for (const element of elementsOf(parse(html))) {
    rejectInlineAttributes(element)
    if (element.tagName === 'script' && !element.attrs.some((attr) => attr.name === 'src'))
      script.add(sha256(textOf(element)))
    if (element.tagName === 'style') style.add(sha256(textOf(element)))
  }
  return { script: [...script], style: [...style] }
}
