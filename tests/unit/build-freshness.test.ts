// scripts/build-freshness.ts: the test runners refuse a build whose sources changed, and only then. `pnpm check`
// regenerates src/sdk with the same bytes (its drift job runs `pnpm codegen`), which must not make the build stale.
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertFreshBuild, writeBuildStamp } from '../../scripts/build-freshness.ts'

let root = ''

const write = (path: string, content: string) => {
  mkdirSync(join(root, path, '..'), { recursive: true })
  writeFileSync(join(root, path), content)
}

/** A checkout with a few inputs and a build of them, stamped as `pnpm build` does. */
const buildCheckout = () => {
  write('package.json', '{}')
  write('src/sdk/sdk.gen.ts', 'export const x = 1\n')
  write('.output/server/index.mjs', '')
  write('.output/nitro.json', '{}')
  writeBuildStamp(root)
}

const later = new Date(Date.now() + 60_000)

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'build-freshness-'))
  vi.stubEnv('ALLOW_STALE_BUILD', '')
  buildCheckout()
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(root, { recursive: true, force: true })
})

describe('assertFreshBuild', () => {
  it('accepts a build whose inputs were rewritten with the same content', () => {
    write('src/sdk/sdk.gen.ts', 'export const x = 1\n')
    utimesSync(join(root, 'src/sdk/sdk.gen.ts'), later, later)
    expect(() => assertFreshBuild(root)).not.toThrow()
  })

  it('names the inputs changed, added or removed since the build', () => {
    write('src/sdk/sdk.gen.ts', 'export const x = 2\n')
    write('src/new.ts', '')
    rmSync(join(root, 'package.json'))
    expect(() => assertFreshBuild(root)).toThrow(
      '.output is older than its sources: package.json, src/new.ts, src/sdk/sdk.gen.ts changed since `pnpm build`',
    )
  })

  it('refuses a build without the stamp, and a checkout without a build', () => {
    rmSync(join(root, '.output/build-inputs.json'))
    expect(() => assertFreshBuild(root)).toThrow('.output/build-inputs.json is missing')
    rmSync(join(root, '.output'), { recursive: true })
    expect(() => assertFreshBuild(root)).toThrow('(expected server/index.mjs and nitro.json)')
  })

  it('skips the comparison with ALLOW_STALE_BUILD=1', () => {
    vi.stubEnv('ALLOW_STALE_BUILD', '1')
    write('src/sdk/sdk.gen.ts', 'export const x = 2\n')
    expect(() => assertFreshBuild(root)).not.toThrow()
  })
})
