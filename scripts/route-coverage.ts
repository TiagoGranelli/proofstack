// Every page route in src/routes must be covered by the accessibility suites (tests/AGENTS.md, "Accessibility"): at
// least one axe state in STATES (tests/e2e/a11y.spec.ts), a landmark snapshot in the `landmarks` block of
// tests/e2e/landmarks.spec.ts, and a row in the tab-order table of tests/e2e/keyboard.spec.ts. Reads the files only
// (no browser, well under 0.1 s), so it runs in `pnpm check`: a new page cannot ship without them.
// Usage: node scripts/route-coverage.ts   (exit 1 and a list of what is missing when a page is not covered)
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const ROUTES = 'src/routes'
const A11Y = 'tests/e2e/a11y.spec.ts'
const LANDMARKS = 'tests/e2e/landmarks.spec.ts'
const KEYBOARD = 'tests/e2e/keyboard.spec.ts'

/**
 * The URL path of a file route, or undefined for files that are not pages: the root and layout routes, API
 * routes, and files TanStack Router ignores (`-` prefix). Pathless (`_x`) and group (`(x)`) segments add
 * nothing to the path; `index` is the parent's path.
 */
export const pagePath = (file: string): string | undefined => {
  const segments = file.replace(/\.tsx?$/, '').split('/')
  if (segments[0] === 'api' || segments.some((segment) => segment.startsWith('-'))) return undefined
  const last = segments.at(-1) ?? ''
  if (last.startsWith('__') || (last.startsWith('_') && !last.includes('.'))) return undefined
  const path = segments
    .filter((segment) => segment !== 'index' && !segment.startsWith('_') && !/^\(.*\)$/.test(segment))
    .join('/')
  return `/${path}`
}

export const pageRoutes = (root = ROUTES): string[] =>
  readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
    .map((entry) => pagePath(relative(root, join(entry.parentPath, entry.name)).split(sep).join('/')))
    .filter((path): path is string => path !== undefined)
    .toSorted()

/**
 * Page paths a block of a spec reaches: every `visit(page, '/path…')`, plus the helpers that reach a page
 * without naming it.
 */
const HELPERS: Array<[RegExp, string]> = [
  // Every API call under /api/me is made by a page of the dashboard.
  [/navigateWithApiResponse\(page, '\/api\/me[/']/, '/dashboard'],
  [/\bdashboardWithMyPost\(/, '/dashboard'],
  [/navigateWithApiResponse\(page, '\/api\/posts'/, '/'],
]
export const reachedPaths = (block: string): Set<string> => {
  const paths = new Set<string>()
  for (const [, path = ''] of block.matchAll(/\bvisit\(page, '([^'?#]*)/g)) paths.add(path)
  for (const [pattern, path] of HELPERS) if (pattern.test(block)) paths.add(path)
  return paths
}

/** Whether a concrete path in `reached` is `route`, whose `$param` segments match any one segment. */
const reaches = (reached: Set<string>, route: string) => {
  const pattern = new RegExp(`^${route.replaceAll(/[.*+?^{}()|[\]\\]/g, '\\$&').replaceAll(/\$[^/]*/g, '[^/]+')}$`)
  return [...reached].some((path) => pattern.test(path))
}

/** A spec file and its text. */
type Spec = { file: string; text: string }

const readSpec = (file: string): Spec => ({ file, text: readFileSync(file, 'utf8') })

/** The text from `start` to the next `end` after it; both must be there (a renamed block fails loudly). */
const between = (spec: Spec, start: string, end?: string) => {
  const from = spec.text.indexOf(start)
  const to = end === undefined ? spec.text.length : spec.text.indexOf(end, from + start.length)
  if (from === -1 || to === -1)
    throw new Error(`${spec.file}: cannot find the block from "${start}" to "${end ?? 'the end of the file'}"`)
  return spec.text.slice(from, to)
}

/** What each page lacks, as `path: missing, missing`; empty when every page is covered. */
export const routeCoverageProblems = (): string[] => {
  const a11y = readSpec(A11Y)
  const landmarks = readSpec(LANDMARKS)
  const keyboard = readSpec(KEYBOARD)
  const suites: Array<[string, Set<string>]> = [
    [`an axe state in STATES (${A11Y})`, reachedPaths(between(a11y, 'const STATES', "test.describe('axe'"))],
    [`a landmark snapshot (${LANDMARKS})`, reachedPaths(between(landmarks, "test.describe('landmarks'"))],
    [`a tab-order row (${KEYBOARD})`, reachedPaths(between(keyboard, "test.describe('tab order'", "test.describe('"))],
  ]
  return pageRoutes().flatMap((path) => {
    const missing = suites.filter(([, reached]) => !reaches(reached, path)).map(([what]) => what)
    return missing.length ? [`${path} is missing ${missing.join(' and ')}`] : []
  })
}

export const routeCoverage = (): boolean => {
  const problems = routeCoverageProblems()
  for (const problem of problems) console.error(problem)
  return problems.length === 0
}

if (import.meta.main) process.exitCode = routeCoverage() ? 0 : 1
