// Repository rules that no linter checks: each test lists every violation with what to do about it.
// Rules about code shape are `no-restricted-syntax` selectors in .oxlintrc.json instead.
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file: string) => readFileSync(file, 'utf8')
const git = (...args: string[]) => spawnSync('git', args, { encoding: 'utf8' })

const GENERATED = [join('src', 'sdk', ''), join('src', 'routeTree.gen.ts')]
const codeFiles = () =>
  [
    ...['src', 'tests', 'scripts'].flatMap((dir) =>
      readdirSync(dir, { recursive: true, encoding: 'utf8' }).map((path) => join(dir, path)),
    ),
    ...readdirSync('.').filter((file) => file.endsWith('.config.ts')),
  ]
    .filter((file) => /\.(?:ts|tsx|mts)$/.test(file) && !GENERATED.some((prefix) => file.startsWith(prefix)))
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

it('every squawk waiver has its reason on the comment line above it', () => {
  const bare = readdirSync('drizzle')
    .filter((name) => name.endsWith('.sql'))
    .flatMap((name) => {
      const lines = read(join('drizzle', name)).split('\n')
      return lines.flatMap((line, index) => {
        const above = lines[index - 1] ?? ''
        return /^\s*--\s*squawk-ignore/.test(line) && (!/^\s*--\s*\S/.test(above) || above.includes('squawk-ignore'))
          ? [`drizzle/${name}:${index + 1}: say why in a comment line above (docs/operations.md, "Migration safety")`]
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
 * Migrations in the journal at CHECK_BASE_REF may already be applied somewhere, and a database never runs an
 * edited migration again. The default HEAD compares the working tree with the last commit; CI sets HEAD^.
 */
describe('applied migrations', () => {
  const base = process.env.CHECK_BASE_REF ?? 'HEAD'
  const JOURNAL = 'drizzle/meta/_journal.json'
  const restore = `restore them (\`git checkout ${base} -- drizzle\`), then change the schema and run \`pnpm db:generate --name <slug>\``
  const hasBase = git('rev-parse', '--verify', '--quiet', `${base}^{commit}`).status === 0

  it('has the base commit to compare with', () => {
    // Only a repository without commits has nothing to compare with by default.
    expect(
      hasBase || process.env.CHECK_BASE_REF === undefined,
      `git ref ${base} is missing: fetch the parent commit (actions/checkout fetch-depth: 2)`,
    ).toBe(true)
  })

  it.runIf(hasBase)('are never edited or deleted', () => {
    const changed = git('diff', '--diff-filter=MD', '--name-only', base, '--', 'drizzle/*.sql').stdout
    expect(
      changed
        .split('\n')
        .filter(Boolean)
        .map((file) => `${file}: ${restore}`),
    ).toEqual([])
  })

  it.runIf(hasBase)('keep their journal entries', () => {
    type Journal = { entries: unknown[] }
    const before = git('show', `${base}:${JOURNAL}`)
    const applied = before.status === 0 ? (JSON.parse(before.stdout) as Journal).entries : []
    const current = (JSON.parse(read(JOURNAL)) as Journal).entries
    expect(current.slice(0, applied.length), `${JOURNAL}: ${restore}`).toEqual(applied)
  })
})

it('keeps Tailwind from scanning the build output', () => {
  // Without source("../") Tailwind scans .output, and the SSR and client CSS hashes diverge (AGENTS.md, "Sharp edges").
  expect(read('src/styles/app.css'), 'src/styles/app.css: keep `@import "tailwindcss" source("../")`').toMatch(
    /@import\s+['"]tailwindcss['"]\s+source\(\s*['"]\.\.\/['"]\s*\)/,
  )
})

/**
 * Folder names under src/ are kebab-case like file names (Oxlint `unicorn/filename-case`), optionally with a
 * TanStack Router prefix: `_` (pathless layout), `$` (path param), `-` (not routed), or `(group)`.
 */
it('names every folder under src/ in kebab-case', () => {
  const FOLDER = /^(?:[_$-]?[a-z0-9]+(?:-[a-z0-9]+)*|\([a-z0-9]+(?:-[a-z0-9]+)*\))$/
  const bad = readdirSync('src', { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !FOLDER.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((folder) => !folder.startsWith(join('src', 'sdk')))
    .map((folder) => `${folder}/: rename it in kebab-case with \`git mv\``)
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
