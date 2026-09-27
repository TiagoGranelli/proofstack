// What the browser bundle may carry of Effect. The forms validate with Effect Schema (the owner's decision in
// docs/critique-2026-09-27.md), so the Schema runtime ships in the chunk the form pages load, and only there. The
// contract's endpoints (`src/contract/posts.ts`, HttpApi) and the HTTP server never do: one careless value import in
// UI code (instead of a type, `src/contract/limits.ts` or an input module such as `src/contract/post-input.ts`)
// would ship them. `verify:app` runs this against the build and the app it tests.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ASSETS = '.output/public/assets'

/**
 * Strings every Effect module carries at runtime: the `~effect/<Module>` type ids (`~effect/Effect`,
 * `~effect/Schema`, `~effect/Context/Service`, ...). They survive minification because they are values.
 */
const EFFECT_RUNTIME = /~effect\/[A-Z]/
/** The same ids of the HttpApi and HTTP modules (`~effect/httpapi/HttpApiEndpoint`, `~effect/http/Headers`). */
const EFFECT_HTTP = /~effect\/https?(api)?\//

const read = (file: string) => readFileSync(join(ASSETS, file), 'utf8')

/** The scripts a page's HTML loads or preloads before any navigation. */
const scriptsOf = async (path: string) => {
  const html = await (await fetch(new URL(path, process.env.APP_URL))).text()
  return [...html.matchAll(/(?:src|href)="\/assets\/([^"]+\.js)"/g)].map((match) => match[1]!)
}

describe('client bundle', () => {
  const scripts = readdirSync(ASSETS).filter((file) => file.endsWith('.js'))

  it('has client scripts to check', () => {
    expect(scripts.length).toBeGreaterThan(0)
  })

  it('contains no HttpApi or HTTP code of Effect in any client chunk', () => {
    expect(scripts.filter((file) => EFFECT_HTTP.test(read(file)))).toEqual([])
  })

  it.each(['/', '/about'])('loads no Effect runtime on %s, which has no form', async (path) => {
    const loaded = await scriptsOf(path)
    expect(loaded.length).toBeGreaterThan(0)
    expect(loaded.filter((file) => EFFECT_RUNTIME.test(read(file)))).toEqual([])
  })

  it('recognizes the Effect runtime where it does belong: the form chunk and the server build', () => {
    expect(scripts.some((file) => EFFECT_RUNTIME.test(read(file)))).toBe(true)
    const server = '.output/server'
    const modules = readdirSync(server, { recursive: true, encoding: 'utf8' }).filter((file) => file.endsWith('.mjs'))
    expect(modules.some((file) => EFFECT_RUNTIME.test(readFileSync(join(server, file), 'utf8')))).toBe(true)
    expect(modules.some((file) => EFFECT_HTTP.test(readFileSync(join(server, file), 'utf8')))).toBe(true)
  })
})
