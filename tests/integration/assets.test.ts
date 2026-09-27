// Every stylesheet, script and modulepreload referenced by rendered HTML must exist in the client
// build and be served with the right type. Catches client/SSR asset hash drift (TanStack/router#7658).
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { appUrl } from './helpers.ts'

const PAGES = ['/', '/about', '/login']

const referencedAssets = (html: string) =>
  [
    ...[...html.matchAll(/<link\b[^>]*\brel="(?:stylesheet|modulepreload)"[^>]*>/g)].map(
      (m) => m[0].match(/\bhref="([^"]+)"/)?.[1],
    ),
    ...[...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]),
  ].filter((url): url is string => !!url?.startsWith('/'))

describe('built assets', () => {
  it.each(PAGES)('%s references only assets that exist and are served', async (page) => {
    const html = await (await fetch(appUrl + page)).text()
    const assets = referencedAssets(html)
    expect(assets.some((url) => url.endsWith('.css'))).toBe(true)
    expect(assets.some((url) => url.endsWith('.js'))).toBe(true)
    for (const asset of assets) {
      const res = await fetch(appUrl + asset)
      expect(existsSync(join('.output/public', asset.split('?')[0]!)), asset).toBe(true)
      expect(res.status, asset).toBe(200)
      expect(res.headers.get('content-type'), asset).toMatch(asset.endsWith('.css') ? /text\/css/ : /javascript/)
    }
  })

  it('serves build-time brotli copies of hashed assets with a long cache lifetime', async () => {
    const html = await (await fetch(appUrl)).text()
    for (const type of ['.js', '.css']) {
      const asset = referencedAssets(html).find((url) => url.startsWith('/assets/') && url.endsWith(type))!
      const res = await fetch(appUrl + asset, { headers: { 'accept-encoding': 'br' } })
      expect(res.headers.get('content-encoding'), asset).toBe('br')
      expect(res.headers.get('cache-control'), asset).toMatch(/max-age=31536000/)
    }
  })

  it('serves the prerendered page as a static file', async () => {
    const res = await fetch(`${appUrl}/about`)
    expect(res.status).toBe(200)
    expect(res.headers.get('etag')).toBeTruthy()
  })
})
