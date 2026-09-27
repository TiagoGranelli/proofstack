// License gate over the production dependencies, the packages whose code ships in .output and the Docker image
// (`pnpm licenses list --json --prod`, read from node_modules: offline, well under a second). Every package must
// carry a license from ALLOWED, satisfy one alternative of an `OR` expression and every part of an `AND`, or
// be one of the exact versions in EXCEPTIONS. Anything else fails, including copyleft licenses (GPL, LGPL,
// AGPL, SSPL, BUSL) and packages without a license.
// Usage: pnpm licenses:check   (a gate of `pnpm check`)
import { xSync } from 'tinyexec'

/** Licenses any production package may carry. `onlyFor` limits one to the packages named there. */
const ALLOWED: Record<string, { why: string; onlyFor?: string[] }> = {
  MIT: { why: 'permissive' },
  'MIT-0': { why: 'permissive, no attribution' },
  ISC: { why: 'permissive' },
  'BSD-2-Clause': { why: 'permissive' },
  'BSD-3-Clause': { why: 'permissive' },
  'Apache-2.0': { why: 'permissive, with a patent grant' },
  '0BSD': { why: 'permissive, no attribution' },
  Unlicense: { why: 'public domain dedication' },
  'CC0-1.0': { why: 'public domain dedication' },
  'BlueOak-1.0.0': { why: 'permissive' },
  'MPL-2.0': {
    why: 'file-level copyleft: only modified MPL files must be published; the bundle uses them unmodified',
  },
  'CC-BY-4.0': {
    why: 'browser support data, not code: attribution only (caniuse-lite, through browserslist)',
    onlyFor: ['caniuse-lite'],
  },
  'Python-2.0': { why: 'permissive (PSF license of the Python argparse port)', onlyFor: ['argparse'] },
}

/**
 * Exact versions accepted with a license outside ALLOWED (a missing or non-SPDX license field that the
 * package's own LICENSE file resolves, for example): `'name@version': 'why'`. None today.
 */
const EXCEPTIONS: Record<string, string> = {}

type Package = { name: string; versions: string[]; license: string }

const listed = xSync('pnpm', ['licenses', 'list', '--json', '--prod'], {
  nodeOptions: { maxBuffer: 64 * 1024 * 1024 },
})
let byLicense: Record<string, Package[]>
try {
  byLicense = JSON.parse(listed.stdout) as Record<string, Package[]>
} catch {
  console.error(`pnpm licenses list failed:\n${(listed.stderr || listed.stdout).trim()}`)
  process.exit(1)
}

/** Evaluates an SPDX expression: OR takes any allowed alternative, AND needs every part, WITH keeps the license. */
const acceptable = (expression: string, name: string): boolean => {
  const tokens = expression.match(/\(|\)|[^\s()]+/g) ?? []
  let position = 0
  const term = (): boolean => {
    const token = tokens[position++]
    if (token === '(') {
      const value = or()
      // Past the closing parenthesis.
      position++
      return value
    }
    // A WITH exception (Classpath, LLVM) only widens what the license allows.
    if (tokens[position] === 'WITH') position += 2
    const license = token?.replace(/\+$/, '')
    const rule = license ? ALLOWED[license] : undefined
    return Boolean(rule && (!rule.onlyFor || rule.onlyFor.includes(name)))
  }
  const and = (): boolean => {
    let value = term()
    while (tokens[position] === 'AND') {
      position++
      value = term() && value
    }
    return value
  }
  const or = (): boolean => {
    let value = and()
    while (tokens[position] === 'OR') {
      position++
      value = or() || value
    }
    return value
  }
  return tokens.length > 0 && or() && position === tokens.length
}

const problems: string[] = []
const used = new Set<string>()
let count = 0
for (const [license, packages] of Object.entries(byLicense))
  for (const { name, versions } of packages)
    for (const version of versions) {
      count++
      const id = `${name}@${version}`
      if (acceptable(license, name)) continue
      if (EXCEPTIONS[id]) {
        used.add(id)
        continue
      }
      const copyleft = /\b(A?GPL|LGPL|SSPL|BUSL|EUPL|OSL|CPAL)\b/i.test(license)
      problems.push(`${id}: ${license}${copyleft ? ' (copyleft: not allowed in the shipped bundle)' : ''}`)
    }
for (const id of Object.keys(EXCEPTIONS))
  if (!used.has(id)) problems.push(`EXCEPTIONS in scripts/licenses.ts: ${id} is not needed anymore; remove it`)

if (problems.length) {
  console.error(`License check failed (${count} production packages):\n${problems.map((p) => `  - ${p}`).join('\n')}`)
  process.exitCode = 1
} else console.log(`ok    ${count} production packages, licenses: ${Object.keys(byLicense).toSorted().join(', ')}`)
