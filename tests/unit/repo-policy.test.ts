// Repository rules that no linter checks: each test lists every violation with what to do about it.
// Rules about code shape are `no-restricted-syntax` selectors in .oxlintrc.json instead.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, sep } from 'node:path'
import { expect, it } from 'vitest'

const read = (file: string) => readFileSync(file, 'utf8')

const GENERATED = new Set([join('src', 'routeTree.gen.ts')])
const codeFiles = () =>
  [
    ...['src', 'tests', 'scripts'].flatMap((dir) =>
      readdirSync(dir, { recursive: true, encoding: 'utf8' }).map((path) => join(dir, path)),
    ),
    ...readdirSync('.').filter((file) => file.endsWith('.config.ts')),
  ]
    .filter((file) => /\.(?:ts|tsx|mts)$/.test(file) && !GENERATED.has(file))
    .toSorted()

// A lint directive: a comment that starts with it, or an end-of-line `-disable-line` one. Oxlint's port of
// eslint-comments/require-description crashes (oxc#17021), so this reads the files itself.
const DIRECTIVE = /^\s*(?:\/\/|\/\*)\s*(?:oxlint|eslint)-disable|\/\/\s*(?:oxlint|eslint)-disable-line/
const COMMENT = /^\s*(?:\/\/|\/\*|\*)/

it('every lint suppression has its reason on the comment line above it', () => {
  const bare = codeFiles().flatMap((file) => {
    const lines = read(file).split('\n')
    return lines.flatMap((line, index) => {
      const above = lines[index - 1] ?? ''
      return DIRECTIVE.test(line) && !(COMMENT.test(above) && !DIRECTIVE.test(above))
        ? [`${file}:${index + 1}: fix the finding, or say why the rule is wrong here in a comment line above`]
        : []
    })
  })
  expect(bare).toEqual([])
})

it('pins every dependency to one exact version', () => {
  const EXACT = /^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/
  const pkg = JSON.parse(read('package.json')) as Partial<Record<string, Record<string, string>>>
  const ranges = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'].flatMap((section) =>
    Object.entries(pkg[section] ?? {})
      .filter(([, version]) => !EXACT.test(version))
      .map(([name, version]) => `${section}.${name} is "${version}": \`pnpm add --save-exact ${name}@<version>\``),
  )
  expect(ranges).toEqual([])
  // `pnpm add` pins exact versions only with this setting.
  expect(read('pnpm-workspace.yaml')).toMatch(/^savePrefix: ''$/m)
})

/**
 * Folder names under src/ are kebab-case like file names (Oxlint `unicorn/filename-case`), optionally with a
 * TanStack Router prefix: `_` (pathless layout), `$` (path param), `-` (not routed), or `(group)`.
 */
it('names every folder under src/ in kebab-case', () => {
  const FOLDER = /^(?:[_$-]?[a-z0-9]+(?:-[a-z0-9]+)*|\([a-z0-9]+(?:-[a-z0-9]+)*\))$/
  const bad = readdirSync('src', { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !FOLDER.test(entry.name))
    .map((entry) => `${join(entry.parentPath, entry.name)}/: rename it in kebab-case with \`git mv\``)
  expect(bad).toEqual([])
})

/** The bytes Codex reads in a file's directory: every AGENTS.md from the root down to it. */
const chainBytes = (file: string) =>
  file
    .split(sep)
    .map((_, index, parts) => join(...parts.slice(0, index), 'AGENTS.md'))
    .filter((path) => existsSync(path))
    .reduce((total, path) => total + statSync(path).size, 0)

// Every session loads the root AGENTS.md, and Codex concatenates the AGENTS.md files from the root down to its
// working directory and silently drops what passes 32 KiB (docs/agents/skills.md).
it('keeps the AGENTS.md files within their size budget', () => {
  const nested = ['src', 'tests', 'scripts', 'docs'].flatMap((dir) =>
    readdirSync(dir, { recursive: true, encoding: 'utf8' })
      .filter((path) => path.split(sep).at(-1) === 'AGENTS.md')
      .map((path) => join(dir, path)),
  )
  const over = [['AGENTS.md', 14 * 1024] as const, ...nested.map((file) => [file, 28 * 1024] as const)]
    .filter(([file, budget]) => chainBytes(file) > budget)
    .map(
      ([file, budget]) =>
        `${file}: ${chainBytes(file)} bytes with the AGENTS.md files above it, over ${budget}. Move reference ` +
        'material behind a pointer (a nested AGENTS.md, a skill or a doc)',
    )
  expect(over).toEqual([])
})
