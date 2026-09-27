// Fast local quality gate for humans, agents and the pre-commit hook: every deterministic check that needs
// no database and no build. Runs all gates even after a failure so one run shows every problem, then prints
// the fix for each failing gate. Gates run one at a time to keep memory bounded.
// Usage: pnpm check [--only=gate,...] [--skip=gate,...]   (CI runs the gates as separate steps)
//
// Gates that compare with what is already there (`security`, the `applied-migrations` guard) use a baseline:
// PROOFSTACK_BASE_DIR / PROOFSTACK_DIFF_FILE when the pre-commit hook sets them (HEAD's drizzle/ and the staged
// diff), otherwise the git ref PROOFSTACK_BASE_REF: by default HEAD locally (uncommitted edits count as new) and
// HEAD^ on GitHub Actions (the commit under test against its parent; the checkout fetches two commits).
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, sep } from 'node:path'
import { routeCoverage } from './route-coverage.ts'
import { binInvocation, pnpmInvocation, runSync } from './spawn.ts'

type Gate = { name: string; run: () => boolean; fix: string }

const script = (name: string) => () =>
  runSync(pnpmInvocation(['run', '--silent', name]), { stdio: 'inherit' }).status === 0
const tool = (name: string, args: string[]) => () =>
  runSync(binInvocation(name, args), { stdio: 'inherit' }).status === 0

const ON_CI = process.env.GITHUB_ACTIONS === 'true'
const BASE_REF = process.env.PROOFSTACK_BASE_REF ?? (ON_CI ? 'HEAD^' : 'HEAD')
const git = (args: string[]) => spawnSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
let baseRefExists: boolean | undefined
const hasBaseRef = () =>
  (baseRefExists ??= git(['rev-parse', '--verify', '--quiet', `${BASE_REF}^{commit}`]).status === 0)
const NO_BASE = ON_CI
  ? `git ref ${BASE_REF} is missing: the CI checkout must fetch the parent commit (actions/checkout fetch-depth: 2)`
  : undefined

/**
 * Effect's language-service diagnostics (floating Effects, missing `yield*`, leaking requirements, …), the same
 * ones the editor shows through the tsconfig plugin. Any diagnostic fails, messages included: silence one site
 * with the JSDoc tag or `@effect-diagnostics` comment its message names, with the reason next to it.
 */
const effect = () => {
  const result = runSync(
    binInvocation('effect-tsgo', ['diagnostics', '--project', 'tsconfig.json', '--format', 'text']),
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  )
  const output = result.stdout
  const counts = /(\d+) errors?, (\d+) warnings? and (\d+) messages?/.exec(output)
  const clean = result.status === 0 && counts?.slice(1).every((count) => count === '0') === true
  process.stdout.write(clean ? `${counts[0]}\n` : output)
  return clean
}

/**
 * Generated code (Hey API's src/sdk, TanStack Router's route tree), which .fallowrc.json keeps out of the
 * `complexity` and `dupes` gates (`health.ignore`, `duplicates.ignore`). `fallow security` has no path setting, so
 * the `security` gate leaves these files out of the diff it compares: a codegen run is not a change we review.
 */
const GENERATED = ['src/sdk/', 'src/routeTree.gen.ts']
const isGenerated = (path: string) => GENERATED.some((prefix) => path.startsWith(prefix))

/** The sections of a unified diff for hand-written files in src/; the hook's staged diff also holds tests and docs. */
const handWrittenSrc = (diff: string) =>
  diff
    .split(/^(?=diff --git )/m)
    .filter((section) => {
      const path = /^diff --git a\/\S+ b\/(\S+)/.exec(section)?.[1]
      return path === undefined || (path.startsWith('src/') && !isGenerated(path))
    })
    .join('')

/** Tracked changes since BASE_REF plus untracked files, like `fallow --changed-since` sees them. */
const changesSinceBase = () => {
  const options = { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 } as const
  const tracked = spawnSync('git', ['diff', '--no-color', '--no-ext-diff', BASE_REF, '--', 'src'], options).stdout
  const untracked = git(['ls-files', '--others', '--exclude-standard', '-z', '--', 'src'])
    .stdout.split('\0')
    .filter(Boolean)
    .map((file) => spawnSync('git', ['diff', '--no-color', '--no-index', '--', '/dev/null', file], options).stdout)
  return [tracked, ...untracked].join('')
}

/** New security-sink candidates (fallow's catalogue: XSS, injection, SSRF, open redirect, …) in src/ lines changed since the baseline. */
const security = () => {
  const diffFile = process.env.PROOFSTACK_DIFF_FILE
  const diff = diffFile ? readFileSync(diffFile, 'utf8') : hasBaseRef() ? changesSinceBase() : undefined
  if (diff === undefined) {
    console.log(NO_BASE ?? 'security: skipped, no git history to compare with')
    return NO_BASE === undefined
  }
  const result = runSync(binInvocation('fallow', ['security', '--gate', 'new', '--diff-stdin', 'src']), {
    input: handWrittenSrc(diff),
    stdio: ['pipe', 'inherit', 'inherit'],
  })
  return result.status === 0
}

/**
 * Any clone group fails (settings in .fallowrc.json `duplicates`). `fallow dupes` itself only fails above a
 * duplication percentage, which a new 20-line copy in a growing code base would never reach.
 */
const dupes = () => {
  const result = runSync(binInvocation('fallow', ['dupes', '--format', 'json', '--no-fragments']), {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    maxBuffer: 64 * 1024 * 1024,
  })
  let groups = Number.NaN
  try {
    groups = (JSON.parse(result.stdout) as { stats: { clone_groups: number } }).stats.clone_groups
  } catch {
    // Not a report (the tool failed): the human run below shows why.
  }
  if (result.status === 0 && groups === 0) {
    console.log('No clone groups outside the ignored files.')
    return true
  }
  tool('fallow', ['dupes'])()
  return false
}

// ---------------------------------------------------------------------------------------------------------------
// Guards: repository rules no tool checks. Each problem says what to do. The line guards take an exception on the
// line directly above the flagged one: `// guards-allow <guard>: <reason, at least 10 characters>`.

const read = (file: string) => readFileSync(file, 'utf8')
const generated = (file: string) => file.startsWith(join('src', 'sdk', '')) || file === join('src', 'routeTree.gen.ts')
const sourceFiles = (dir: string) =>
  existsSync(dir)
    ? readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile() && /\.(?:ts|tsx|mts)$/.test(entry.name))
        .map((entry) => join(entry.parentPath, entry.name))
        .filter((file) => !generated(file))
    : []
const configFiles = () => readdirSync('.').filter((file) => file.endsWith('.config.ts'))
const SRC = () => sourceFiles('src')
const TESTS = () => sourceFiles('tests')
const ALL_CODE = () => [...SRC(), ...TESTS(), ...sourceFiles('scripts'), ...configFiles()]
const WAITING_TESTS = () => ['component', 'e2e', 'integration'].flatMap((layer) => sourceFiles(join('tests', layer)))

type LineGuard = { id: string; files: () => string[]; pattern: RegExp; problem: string }

const LINE_GUARDS: LineGuard[] = [
  {
    id: 'focused-test',
    files: TESTS,
    pattern: /\b(?:it|test|describe|suite)(?:\.\w+)*\.(?:only|fixme|todo)\s*\(/,
    problem:
      '`.only` runs this test alone and `.fixme`/`.todo` ship a test that checks nothing. Remove the modifier ' +
      '(or write the test)',
  },
  {
    id: 'skipped-test',
    files: TESTS,
    pattern: /\b(?:it|test|describe|suite)(?:\.\w+)*\.skip\s*\(\s*(?:['"`]|\))|\bx(?:it|test|describe)\s*\(/,
    problem:
      'skips a test unconditionally, so it can never fail again. Fix the test or delete it; a skip that depends on ' +
      'the browser or platform takes a condition: `test.skip(({ isMobile }) => isMobile, "reason")`',
  },
  {
    id: 'test-sleep',
    files: WAITING_TESTS,
    pattern: /\bwaitForTimeout\s*\(|\bsetTimeout\s*\(|\bsleep\s*\(/,
    problem:
      'waits a fixed time: flaky on a slow machine, slow on a fast one. Wait for the condition itself (web-first ' +
      '`await expect(locator)...`, `expect.element`, `expect.poll`, `vi.waitFor`)',
  },
  {
    id: 'tautology',
    files: TESTS,
    pattern:
      /\bexpect\s*\(\s*(?:true|false|null|undefined|-?\d[\d_]*(?:\.\d+)?|'[^'\\]*'|"[^"\\]*"|`[^`$\\]*`)\s*\)\s*\.(?:not\.)?to(?:Be|Equal|StrictEqual)\b/,
    problem: 'asserts on a literal, so it can never fail. Put the value under test in `expect(...)`',
  },
  {
    id: 'double-cast',
    files: SRC,
    pattern: /\bas\s+unknown\s+as\b/,
    problem:
      '`as unknown as` switches the type checker off. Decode the value (Effect Schema) or fix the type where it ' +
      'comes from',
  },
  {
    id: 'cors',
    files: SRC,
    pattern: /access-control-allow-origin/i,
    problem:
      'sets CORS in application code. The app is same-origin (src/start.ts rejects foreign origins); opening it to ' +
      'other origins is a reviewed edge decision (deploy/Caddyfile), not a header in src/',
  },
]

const allowedAbove = (lines: string[], index: number, id: string) =>
  new RegExp(`guards-allow ${id}: .{10,}`).test(lines[index - 1] ?? '')

const lineGuardProblems = ({ id, files, pattern, problem }: LineGuard) =>
  files().flatMap((file) => {
    const lines = read(file).split('\n')
    return lines.flatMap((line, index) =>
      pattern.test(line) && !allowedAbove(lines, index, id) ? [`${file}:${index + 1}: [${id}] ${problem}`] : [],
    )
  })

const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*)/
// A directive: a comment that starts with it, or an end-of-line `-disable-line` one.
const DISABLE = /^\s*(?:\/\/|\/\*)\s*(?:oxlint|eslint)-disable|\/\/\s*(?:oxlint|eslint)-disable-line/

/** A lint suppression needs its reason on the comment line directly above it. */
const bareDisables = () =>
  ALL_CODE().flatMap((file) => {
    const lines = read(file).split('\n')
    return lines.flatMap((line, index) => {
      const above = lines[index - 1] ?? ''
      const explained = COMMENT_LINE.test(above) && !DISABLE.test(above)
      return DISABLE.test(line) && !explained
        ? [
            `${file}:${index + 1}: [bare-disable] a lint suppression without a reason. Fix the finding instead; if ` +
              'the rule is wrong here, say why in a comment on the line directly above the directive',
          ]
        : []
    })
  })

/** VITE_* variables are compiled into the browser bundle. Add one here only if its value may be public. */
const PUBLIC_VITE_ENV = new Set<string>([])

const viteEnv = () =>
  SRC().flatMap((file) =>
    [...read(file).matchAll(/import\.meta\.env\.(VITE_\w+)/g)]
      .filter(([, name]) => !PUBLIC_VITE_ENV.has(name ?? ''))
      .map(
        ([match]) =>
          `${file}: [vite-env] ${match} ships in the browser bundle, so its value is public. Read server ` +
          'configuration through src/server/env.ts; a variable that is public by design goes in PUBLIC_VITE_ENV ' +
          '(scripts/check.ts)',
      ),
  )

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/
const DEPENDENCY_SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const

const exactVersions = () => {
  const pkg = JSON.parse(read('package.json')) as Partial<Record<string, Record<string, string>>>
  const ranges = DEPENDENCY_SECTIONS.flatMap((section) =>
    Object.entries(pkg[section] ?? {})
      .filter(([, version]) => !EXACT_VERSION.test(version))
      .map(
        ([name, version]) =>
          `package.json: [exact-versions] ${section}.${name} is "${version}". Pin one version: ` +
          `\`pnpm add --save-exact ${name}@<version>\` (the lockfile must change with it)`,
      ),
  )
  const savePrefix = /^savePrefix:\s*(?:''|"")\s*$/m.test(read('pnpm-workspace.yaml'))
    ? []
    : ["pnpm-workspace.yaml: [exact-versions] must keep `savePrefix: ''` so `pnpm add` pins exact versions"]
  return [...ranges, ...savePrefix]
}

/** Operations anyone may call without a session. A new public endpoint is a deliberate edit here. */
const PUBLIC_OPERATIONS = new Set(['GET /api/health', 'GET /api/ready', 'GET /api/posts'])

const openapiSecurity = () => {
  type Operation = { security?: unknown[] }
  const spec = JSON.parse(read('openapi.json')) as { paths: Record<string, Record<string, Operation>> }
  const operations = Object.entries(spec.paths).flatMap(([path, methods]) =>
    Object.entries(methods).map(([method, op]) => ({ key: `${method.toUpperCase()} ${path}`, op })),
  )
  const unauthenticated = operations
    .filter(({ key, op }) => !PUBLIC_OPERATIONS.has(key) && (op.security ?? []).length === 0)
    .map(
      ({ key }) =>
        `openapi.json: [openapi-security] ${key} declares no security, so anyone can call it. Put its group behind ` +
        'the `Authentication` middleware (src/contract) and run `pnpm codegen`; if it is public by design, add it to ' +
        'PUBLIC_OPERATIONS in scripts/check.ts',
    )
  const known = new Set(operations.map(({ key }) => key))
  const stale = [...PUBLIC_OPERATIONS]
    .filter((key) => !known.has(key))
    .map(
      (key) => `scripts/check.ts: [openapi-security] PUBLIC_OPERATIONS lists ${key}, which openapi.json no longer has`,
    )
  return [...unauthenticated, ...stale]
}

/** The only Start server routes: everything else goes through the contract (openapi.json, SDK, middleware). */
const SERVER_ROUTES = new Set([join('src', 'routes', 'api', '$.ts'), join('src', 'routes', 'api', 'auth', '$.ts')])
const SERVER_ROUTE = /\bcreateServerFileRoute\b|\bserver\s*:\s*\{[\s\S]*?\bhandlers\s*:/

const serverRoutes = () =>
  sourceFiles(join('src', 'routes'))
    .filter((file) => !SERVER_ROUTES.has(file))
    .filter((file) => file.startsWith(join('src', 'routes', 'api', '')) || SERVER_ROUTE.test(read(file)))
    .map(
      (file) =>
        `${file}: [server-routes] a raw HTTP route bypasses the API contract (no openapi.json entry, no SDK, no ` +
        'Authentication middleware). Add an endpoint to src/contract and src/server/api/handlers.ts instead; a ' +
        'deliberate raw route goes in SERVER_ROUTES in scripts/check.ts with its reason',
    )

const STANDARD_SCHEMA = /^\s*Schema\.toStandardSchemaV1\(/
const VALIDATOR_CALL = /\.(?:input)?[vV]alidator\(/g

/** A server function's validator is the only check between the network and the handler. */
const serverFunctionValidators = () =>
  SRC()
    .filter((file) => read(file).includes('createServerFn'))
    .flatMap((file) => {
      const text = read(file)
      return [...text.matchAll(VALIDATOR_CALL)].flatMap((match) => {
        const argument = text.slice(match.index + match[0].length)
        const name = /^\s*(\w+)\s*\)/.exec(argument)?.[1]
        const bound = name !== undefined && new RegExp(`\\b${name}\\s*=\\s*Schema\\.toStandardSchemaV1\\(`).test(text)
        if (STANDARD_SCHEMA.test(argument) || bound) return []
        const line = text.slice(0, match.index).split('\n').length
        return [
          `${file}:${line}: [server-fn-validator] a server function validator must decode with Effect Schema: ` +
            '`.validator(Schema.toStandardSchemaV1(Schema.Struct({ ... })))`. An identity function or a cast lets ' +
            'any payload through',
        ]
      })
    })

const JOURNAL = join('drizzle', 'meta', '_journal.json')
type JournalEntry = { idx: number; tag: string }

/** A file as it is in the baseline; undefined when the baseline does not have it. */
const baselineFile = (path: string) => {
  const dir = process.env.PROOFSTACK_BASE_DIR
  if (dir) return existsSync(join(dir, path)) ? read(join(dir, path)) : undefined
  const result = git(['show', `${BASE_REF}:${path}`])
  return result.status === 0 ? result.stdout : undefined
}

const entriesOf = (journal: string | undefined) =>
  journal === undefined ? [] : (JSON.parse(journal) as { entries: JournalEntry[] }).entries

const changedMigration = (entry: JournalEntry, current: JournalEntry | undefined) => {
  const sql = join('drizzle', `${entry.tag}.sql`)
  const same = existsSync(sql) && read(sql) === baselineFile(sql)
  if (same && JSON.stringify(current) === JSON.stringify(entry)) return []
  return [
    `${sql}: [applied-migrations] migration ${entry.idx} is in the journal at ${BASE_REF}, so databases may have ` +
      'applied it and will never run an edit. Restore it and its journal entry ' +
      `(\`git checkout ${BASE_REF} -- ${sql} ${JOURNAL}\`), then change the schema and run ` +
      '`pnpm db:generate --name <slug>` for a new migration',
  ]
}

/** Migrations already in the baseline's journal must be unchanged (drizzle/*.sql and their journal entries). */
const appliedMigrations = () => {
  if (!process.env.PROOFSTACK_BASE_DIR && !hasBaseRef()) return NO_BASE ? [`[applied-migrations] ${NO_BASE}`] : []
  const current = existsSync(JOURNAL) ? entriesOf(read(JOURNAL)) : []
  return entriesOf(baselineFile(JOURNAL)).flatMap((entry, index) => changedMigration(entry, current[index]))
}

/** Invariants that fail silently at runtime (see AGENTS.md "Sharp edges"). */
const tailwindSource = () =>
  /@import\s+['"]tailwindcss['"]\s+source\(\s*['"]\.\.\/['"]\s*\)/.test(read('src/styles/app.css'))
    ? []
    : [
        'src/styles/app.css: [tailwind-source] must keep `@import "tailwindcss" source("../")`: without it Tailwind ' +
          'scans build output and the SSR and client CSS diverge',
      ]

/**
 * Folder names under src/ are kebab-case, like file names (Oxlint `unicorn/filename-case` checks those). A
 * TanStack Router prefix is allowed in front: `_` (pathless layout), `$` (path param), `-` (excluded from
 * routing), or the whole name in parentheses (route group). src/sdk is generated by Hey API.
 */
const FOLDER_NAME = /^(?:[_$-]?[a-z0-9]+(?:-[a-z0-9]+)*|\([a-z0-9]+(?:-[a-z0-9]+)*\))$/

const badFolders = () =>
  readdirSync('src', { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !FOLDER_NAME.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((folder) => !folder.startsWith(join('src', 'sdk', '')))
    .map(
      (folder) =>
        `${folder}/: [folder-name] must be kebab-case (optionally with a TanStack route prefix: _, $, -, or (group)); ` +
        'rename it with `git mv`',
    )

// Agent instructions: every session loads the root AGENTS.md, and Codex concatenates the AGENTS.md files from the
// root down to its working directory and silently drops what passes 32 KiB (docs/agents/skills.md).
const AGENTS_ROOT_BYTES = 14 * 1024
const AGENTS_CHAIN_BYTES = 28 * 1024
const agentsFiles = () =>
  ['src', 'tests', 'scripts', 'docs'].flatMap((dir) =>
    readdirSync(dir, { recursive: true, encoding: 'utf8' })
      .filter((path) => path.split(sep).at(-1) === 'AGENTS.md')
      .map((path) => join(dir, path)),
  )
/** The bytes Codex reads in the file's directory: every AGENTS.md from the root down to it. */
const chainBytes = (file: string) =>
  file
    .split(sep)
    .map((_, index, parts) => join(...parts.slice(0, index), 'AGENTS.md'))
    .filter((path) => existsSync(path))
    .reduce((total, path) => total + statSync(path).size, 0)
const agentsBudget = () =>
  [['AGENTS.md', AGENTS_ROOT_BYTES] as const, ...agentsFiles().map((file) => [file, AGENTS_CHAIN_BYTES] as const)]
    .filter(([file, budget]) => chainBytes(file) > budget)
    .map(
      ([file, budget]) =>
        `${file}: [agent-docs] ${chainBytes(file)} bytes with the AGENTS.md files above it, over ${budget}. Move reference material behind a pointer (a nested AGENTS.md, a skill or a doc)`,
    )

const guards = () => {
  const problems = [
    ...LINE_GUARDS.flatMap((guard) => lineGuardProblems(guard)),
    ...bareDisables(),
    ...viteEnv(),
    ...exactVersions(),
    ...openapiSecurity(),
    ...serverRoutes(),
    ...serverFunctionValidators(),
    ...appliedMigrations(),
    ...tailwindSource(),
    ...badFolders(),
    ...agentsBudget(),
  ]
  for (const problem of problems) console.error(problem)
  return problems.length === 0
}

const GATES: Gate[] = [
  { name: 'format:check', run: script('format:check'), fix: 'run `pnpm format`' },
  {
    // Zero warnings: `pnpm lint` runs oxlint with --deny-warnings, and every rule in .oxlintrc.json is error or off.
    name: 'lint',
    run: script('lint'),
    fix:
      'run `pnpm lint:fix`, then fix what remains by hand (lint one file: `pnpm lint src/x.ts`). A rule that is ' +
      'wrong for one line: `// oxlint-disable-next-line <rule>` under a comment that says why',
  },
  {
    name: 'typecheck',
    run: script('typecheck'),
    fix: 'fix the type errors; if they are in src/sdk run `pnpm codegen`, if in src/routeTree.gen.ts run `pnpm build`',
  },
  {
    name: 'effect',
    run: effect,
    fix:
      'fix what the Effect diagnostic says (its text explains the fix). A deliberate exception takes the JSDoc tag ' +
      'or `// @effect-diagnostics <rule>:off` comment the message names, with the reason next to it',
  },
  {
    name: 'deadcode',
    run: script('deadcode'),
    fix:
      'remove the unused file, export or dependency (every Fallow finding fails, warnings included). An export ' +
      'that is intentional public surface gets a commented exception in .fallowrc.json instead. A boundary violation or a file outside every zone is ' +
      'configured in .fallowrc.json: `boundaries.rules` says which zone may import which, `boundaries.zones` ' +
      'maps files to zones (a new top-level src/ directory needs a zone there)',
  },
  {
    // Thresholds in .fallowrc.json `health`: cognitive 15, cyclomatic 20 per function.
    name: 'complexity',
    run: tool('fallow', ['health', '--complexity']),
    fix:
      'split the function named above into smaller, named steps (extract the loop body, the branches, the ' +
      'setup). Only a function that is irreducible gets a `health.thresholdOverrides` entry in .fallowrc.json, ' +
      'with its reason',
  },
  {
    name: 'dupes',
    run: dupes,
    fix:
      'extract the duplicated block into one function or module and call it from both places (`fallow dupes ' +
      '--trace <file>:<line>` shows every copy). A reviewed, deliberate clone goes in `duplicates.ignoredClones` ' +
      'in .fallowrc.json with a comment',
  },
  {
    name: 'security',
    run: security,
    fix:
      'the change adds a security-sink candidate in src/ (see its evidence and trace). Make untrusted input unable ' +
      'to reach it (validate, encode, allowlist). If it is a false positive, rewrite it so the sink takes no ' +
      'untrusted input, or add `// fallow-ignore-next-line security-sink` above it with the reason',
  },
  {
    // unit, api and component tests in one Vitest run (one Chromium start), with the coverage gate on the
    // security-critical modules listed in vitest.config.ts. About 5 s; needs `pnpm exec playwright install chromium`.
    name: 'tests',
    run: script('test:fast'),
    fix:
      'fix the failing test or the code it covers. Run one layer: `pnpm test:unit|test:api|test:component ' +
      '[filter]`. A coverage failure names a module in COVERAGE_GATE (vitest.config.ts): cover every line and ' +
      'branch it reports; coverage/index.html shows which',
  },
  {
    name: 'drift',
    run: () =>
      spawnSync('node', ['scripts/check-drift.ts', 'contract', 'migrations', 'auth'], { stdio: 'inherit' }).status ===
      0,
    fix:
      'regenerate what the drift report names: contract -> `pnpm codegen`, migrations -> `pnpm db:generate`; ' +
      'auth -> edit src/server/db/schema/auth.ts by hand (skill auth-change, "Auth config change"). Commit the ' +
      'generated files with their source',
  },
  {
    // squawk over the migrations after the grandfathered ones (.squawk.toml). The first run downloads the pinned
    // binary into ~/.cache/proofstack; later runs are offline, about 0.1 s.
    name: 'migration-lint',
    run: script('check:migrations'),
    fix:
      'make the migration safe or waive the statement with `-- squawk-ignore <rule>` under a comment that says ' +
      'why (docs/operations.md, "Migration safety")',
  },
  {
    // Production dependencies only, read from node_modules (offline, about 0.2 s).
    name: 'licenses',
    run: script('licenses:check'),
    fix:
      'replace the dependency, or, if its license is acceptable, allow it in scripts/licenses.ts (ALLOWED for a ' +
      'license, EXCEPTIONS for one exact version) with the reason',
  },
  {
    // Every page route has an axe state, a landmark snapshot and a tab-order row (scripts/route-coverage.ts).
    name: 'routes',
    run: routeCoverage,
    fix:
      'add what is listed above for each page: an entry in STATES and a landmark snapshot in ' +
      'tests/e2e/a11y.spec.ts, and a row in the tab-order table of tests/e2e/keyboard.spec.ts (tests/AGENTS.md, "Accessibility")',
  },
  {
    name: 'guards',
    run: guards,
    fix:
      'each line above names its guard in [brackets] and what to do. A deliberate exception to a line guard ' +
      'takes `// guards-allow <guard>: <reason>` on the line above; the others have an allowlist in scripts/check.ts',
  },
]

const list = (name: string) =>
  process.argv
    .find((a) => a.startsWith(`--${name}=`))
    ?.slice(name.length + 3)
    .split(',')
const [only, skip] = [list('only'), list('skip')]
const unknown = [...(only ?? []), ...(skip ?? [])].filter((name) => !GATES.some((gate) => gate.name === name))
if (unknown.length) {
  console.error(`unknown gate(s): ${unknown.join(', ')}; expected ${GATES.map((gate) => gate.name).join(', ')}`)
  process.exit(2)
}
const selected = GATES.filter((gate) => (!only || only.includes(gate.name)) && !skip?.includes(gate.name))

const results = selected.map((gate) => {
  const started = performance.now()
  const ok = gate.run()
  return { name: gate.name, fix: gate.fix, ok, seconds: (performance.now() - started) / 1000 }
})

console.log('')
for (const { name, ok, seconds } of results)
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(14)} ${seconds.toFixed(1)}s`)
const failed = results.filter((result) => !result.ok)
if (failed.length > 0) {
  console.error(`\n${failed.length} gate(s) failed:`)
  for (const { name, fix } of failed) console.error(`  ${name}: ${fix}`)
  console.error('Then re-run `pnpm check`.')
  process.exitCode = 1
}
