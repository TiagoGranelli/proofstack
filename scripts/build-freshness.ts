// Whether .output was built from the sources on disk. At the end of `pnpm build`, Nitro's `compiled` hook
// (vite.config.ts) writes the SHA-256 of every build input to .output/build-inputs.json; the test runners and
// lighthouse (startApp in scripts/app-server.ts) compare it with the inputs as they are now.
// Content, not modification times: the drift job of `pnpm check` runs `pnpm codegen`, which rewrites src/sdk with
// the same bytes (Hey API empties its output folder first), and a checkout or an editor can rewrite a file
// unchanged too. None of that makes the build stale.
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

// Everything the build reads. drizzle/ is not built in (migrations are applied from the folder).
const BUILD_INPUTS = ['src', 'public', 'vite.config.ts', 'package.json', 'pnpm-lock.yaml', 'tsconfig.json']
const STAMP = '.output/build-inputs.json'

/** Path of each input file (relative to the checkout, `/`-separated) to the SHA-256 of its content. */
type InputHashes = Record<string, string>

const filesOf = (root: string, input: string): string[] => {
  const path = join(root, input)
  if (!existsSync(path)) return []
  if (!statSync(path).isDirectory()) return [path]
  return readdirSync(path, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
}

const sha256 = (file: string): string => createHash('sha256').update(readFileSync(file)).digest('hex')

/** The hash of every build input in the checkout at `root`. */
export const hashBuildInputs = (root = '.'): InputHashes => {
  const files = BUILD_INPUTS.flatMap((input) => filesOf(root, input))
  const hashes = files.map((file) => [relative(root, file).split(sep).join('/'), sha256(file)] as const)
  return Object.fromEntries(hashes.toSorted(([a], [b]) => a.localeCompare(b)))
}

/** Records what `root`/.output was built from. */
export const writeBuildStamp = (root = '.'): void => {
  writeFileSync(join(root, STAMP), `${JSON.stringify(hashBuildInputs(root), null, 2)}\n`)
}

/** Input files added, removed or changed between two sets of hashes, sorted. */
const changedInputs = (built: InputHashes, now: InputHashes): string[] => {
  const paths = new Set([...Object.keys(built), ...Object.keys(now)])
  return [...paths].filter((path) => built[path] !== now[path]).toSorted()
}

/** The first ten paths, and how many more there are. */
const listSome = (paths: string[]): string =>
  paths.slice(0, 10).join(', ') + (paths.length > 10 ? ` and ${paths.length - 10} more` : '')

/**
 * Refuses to test a build whose inputs changed since it was built. ALLOW_STALE_BUILD=1 skips the comparison
 * (CI tests the build job's artifact).
 */
export const assertFreshBuild = (root = '.'): void => {
  const output = join(root, '.output')
  if (!existsSync(join(output, 'server/index.mjs')) || !existsSync(join(output, 'nitro.json')))
    throw new Error(`No build in ${output} (expected server/index.mjs and nitro.json). Run \`pnpm build\` first.`)
  if (process.env.ALLOW_STALE_BUILD === '1') return
  if (!existsSync(join(root, STAMP)))
    throw new Error(`${STAMP} is missing, so .output was not built by \`pnpm build\`. Run \`pnpm build\` first.`)
  const built = JSON.parse(readFileSync(join(root, STAMP), 'utf8')) as InputHashes
  const changed = changedInputs(built, hashBuildInputs(root))
  if (changed.length === 0) return
  throw new Error(
    `.output is older than its sources: ${listSome(changed)} changed since \`pnpm build\`. Run \`pnpm build\` ` +
      'first (or set ALLOW_STALE_BUILD=1 to test the old build anyway).',
  )
}
