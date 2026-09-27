// The browser bundle must never contain server-side runtimes. The contract (`src/contract`) is written with
// Effect Schema and shared with the server, so one careless value import in UI code (instead of a type or a
// constant from `src/contract/limits.ts`) would ship the Effect runtime to every visitor. `verify:app` runs
// this against the build it tests.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ASSETS = '.output/public/assets'

/**
 * Strings every Effect module carries at runtime: the `~effect/<Module>` type ids (`~effect/Effect`,
 * `~effect/Schema`, `~effect/Context/Service`, ...). They survive minification because they are values.
 */
const EFFECT_RUNTIME = /~effect\/[A-Z]/

describe('client bundle', () => {
  const scripts = readdirSync(ASSETS).filter((file) => file.endsWith('.js'))

  it('has client scripts to check', () => {
    expect(scripts.length).toBeGreaterThan(0)
  })

  it('contains no Effect runtime in any client chunk', () => {
    const withEffect = scripts.filter((file) => EFFECT_RUNTIME.test(readFileSync(join(ASSETS, file), 'utf8')))
    expect(withEffect).toEqual([])
  })

  it('recognizes the Effect runtime where it does belong (the server build)', () => {
    const server = '.output/server'
    const modules = readdirSync(server, { recursive: true, encoding: 'utf8' }).filter((file) => file.endsWith('.mjs'))
    expect(modules.some((file) => EFFECT_RUNTIME.test(readFileSync(join(server, file), 'utf8')))).toBe(true)
  })
})
