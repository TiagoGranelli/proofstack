// What the browser bundle may carry of Effect. The forms validate with Effect Schema (the owner's decision in
// docs/critique-2026-09-27.md), so the Schema runtime ships in a chunk the forms import on their first interaction
// (src/components/form/lazy-schema.ts), and no page loads or preloads it up front: preloading it kept the form pages'
// mobile Lighthouse score under 100. The contract's endpoints (`src/contract/posts.ts`, HttpApi) and the HTTP server
// never ship: one careless value import in UI code (instead of a type, `src/contract/limits.ts` or an input module
// such as `src/contract/post-input.ts`) would ship them. `verify:app` runs this against the build and the app.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { clientIps, signIn, users } from './helpers.ts'

const ASSETS = '.output/public/assets'

/**
 * Strings every Effect module carries at runtime: the `~effect/<Module>` type ids (`~effect/Effect`,
 * `~effect/Schema`, `~effect/Context/Service`, ...). They survive minification because they are values.
 */
const EFFECT_RUNTIME = /~effect\/[A-Z]/
/** The same ids of the HttpApi and HTTP modules (`~effect/httpapi/HttpApiEndpoint`, `~effect/http/Headers`). */
const EFFECT_HTTP = /~effect\/https?(api)?\//

const read = (file: string) => readFileSync(join(ASSETS, file), 'utf8')

/** The scripts a page's HTML loads or preloads before any navigation (`<script src>`, `modulepreload`). */
const scriptsOf = async (path: string, cookie?: string) => {
  const response = await fetch(new URL(path, process.env.APP_URL), { headers: cookie ? { cookie } : {} })
  expect(new URL(response.url).pathname, `${path} redirected`).toBe(new URL(path, 'http://x').pathname)
  const html = await response.text()
  return [...html.matchAll(/(?:src|href)="\/assets\/([^"]+\.js)"/g)].map((match) => match[1]!)
}

/** Every page, the form pages included: the reset and verification forms only render with a token. */
const PUBLIC_PAGES = [
  '/',
  '/about',
  '/login',
  '/sign-up',
  '/forgot-password',
  '/reset-password?token=t',
  '/verify-email',
]
const SIGNED_IN_PAGES = ['/dashboard', '/account']
const nextIp = clientIps('100.64.9')

describe('client bundle', () => {
  const scripts = readdirSync(ASSETS).filter((file) => file.endsWith('.js'))

  it('has client scripts to check', () => {
    expect(scripts.length).toBeGreaterThan(0)
  })

  it('contains no HttpApi or HTTP code of Effect in any client chunk', () => {
    expect(scripts.filter((file) => EFFECT_HTTP.test(read(file)))).toEqual([])
  })

  it.each(PUBLIC_PAGES)('loads and preloads no Effect runtime on %s before an interaction', async (path) => {
    const loaded = await scriptsOf(path)
    expect(loaded.length).toBeGreaterThan(0)
    expect(loaded.filter((file) => EFFECT_RUNTIME.test(read(file)))).toEqual([])
  })

  describe('signed in', () => {
    let cookie: string
    beforeAll(async () => {
      cookie = await signIn(users.author, nextIp())
    })

    it.each(SIGNED_IN_PAGES)('loads and preloads no Effect runtime on %s before an interaction', async (path) => {
      const loaded = await scriptsOf(path, cookie)
      expect(loaded.length).toBeGreaterThan(0)
      expect(loaded.filter((file) => EFFECT_RUNTIME.test(read(file)))).toEqual([])
    })
  })

  it('recognizes the Effect runtime where it does belong: the lazy form chunk and the server build', () => {
    expect(scripts.some((file) => EFFECT_RUNTIME.test(read(file)))).toBe(true)
    const server = '.output/server'
    const modules = readdirSync(server, { recursive: true, encoding: 'utf8' }).filter((file) => file.endsWith('.mjs'))
    expect(modules.some((file) => EFFECT_RUNTIME.test(readFileSync(join(server, file), 'utf8')))).toBe(true)
    expect(modules.some((file) => EFFECT_HTTP.test(readFileSync(join(server, file), 'utf8')))).toBe(true)
  })
})
