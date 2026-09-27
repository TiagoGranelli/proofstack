// Every stylesheet, script and modulepreload referenced by rendered HTML must exist in the client
// build and be served with the right type. Catches client/SSR asset hash drift (TanStack/router#7658).
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { appUrl } from './helpers.ts'

const PAGES = ['/', '/about', '/login']
/** Raw (uncompressed) size of the CSS inlined into every page; about 28 KB today. */
const INLINE_CSS_BUDGET = 40 * 1024

const referencedAssets = (html: string) =>
  [
    ...[...html.matchAll(/<link\b[^>]*\brel="(?:stylesheet|modulepreload)"[^>]*>/g)].map(
      (m) => m[0].match(/\bhref="([^"]+)"/)?.[1],
    ),
    ...[...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]),
  ].filter((url): url is string => !!url?.startsWith('/'))

// Route CSS is inlined by Start (server.build.inlineCss in vite.config.ts) for a faster first paint.
const inlineCss = (html: string) =>
  html.match(/<style\b[^>]*\bdata-tsr-inline-css\b[^>]*>([\s\S]*?)<\/style>/)?.[1] ?? ''

const clientCss = () =>
  readdirSync('.output/public/assets')
    .filter((file) => file.endsWith('.css'))
    .map((file) => readFileSync(join('.output/public/assets', file), 'utf8').trimEnd())

describe('built assets', () => {
  it.each(PAGES)('%s references only assets that exist and are served', async (page) => {
    const html = await (await fetch(appUrl + page)).text()
    const assets = referencedAssets(html)
    // Styled either way: inlined Tailwind output (with a utility the layout uses) or a linked stylesheet.
    expect(inlineCss(html).includes('.max-w-2xl') || assets.some((url) => url.endsWith('.css'))).toBe(true)
    expect(assets.some((url) => url.endsWith('.js'))).toBe(true)
    for (const asset of assets) {
      const res = await fetch(appUrl + asset)
      expect(existsSync(join('.output/public', asset.split('?')[0]!)), asset).toBe(true)
      expect(res.status, asset).toBe(200)
      expect(res.headers.get('content-type'), asset).toMatch(asset.endsWith('.css') ? /text\/css/ : /javascript/)
    }
  })

  // With inlined CSS a divergent SSR build no longer 404s; it silently ships different styles. The server
  // build must inline exactly the stylesheet the client build produced (same Tailwind scan, same classes).
  it.each(PAGES)('%s inlines the client build stylesheet, within budget', async (page) => {
    const css = inlineCss(await (await fetch(appUrl + page)).text())
    if (!css) return
    expect(clientCss()).toContain(css.trimEnd())
    expect(css.length).toBeLessThanOrEqual(INLINE_CSS_BUDGET)
  })

  it('serves build-time brotli copies of hashed assets with a long cache lifetime', async () => {
    const html = await (await fetch(appUrl)).text()
    const script = referencedAssets(html).find((url) => url.startsWith('/assets/') && url.endsWith('.js'))!
    const res = await fetch(appUrl + script, { headers: { 'accept-encoding': 'br' } })
    expect(res.headers.get('content-encoding')).toBe('br')
    expect(res.headers.get('cache-control')).toMatch(/max-age=31536000/)
  })

  it('serves the prerendered page as a static file', async () => {
    const res = await fetch(`${appUrl}/about`)
    expect(res.status).toBe(200)
    expect(res.headers.get('etag')).toBeTruthy()
  })
})
