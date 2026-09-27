// Migration safety lint: squawk over drizzle/*.sql with .squawk.toml, failing on any finding (a lock or rewrite
// that blocks a busy table, a non-concurrent index, a column type change...). Migrations listed in
// .squawk.toml `excluded_paths` are grandfathered. A waiver is `-- squawk-ignore <rule>` right under a comment
// line that gives the reason (docs/operations.md, "Migration safety"); a bare squawk-ignore fails here.
// Every run first lints a known-bad statement and fails unless squawk flags it, so a broken binary or config
// cannot pass silently.
// squawk is a pinned release binary, verified by sha256 and cached in ~/.cache/proofstack (XDG_CACHE_HOME):
// the first run downloads it from GitHub, later runs are offline (about 0.1 s).
// Usage: pnpm check:migrations   (a gate of `pnpm check`)
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const VERSION = '2.66.0'
/** sha256 of each release asset, as GitHub lists it (`gh release view v2.66.0 --repo sbdchd/squawk --json assets`). */
const ASSETS: Record<string, { file: string; sha256: string }> = {
  'linux-x64-glibc': {
    file: 'squawk-linux-x64',
    sha256: 'e7965f8146b53cfa7a4625ceecfea5c6aeb35add39132210aa60b11ae180b9f4',
  },
  'linux-x64-musl': {
    file: 'squawk-linux-musl-x64',
    sha256: 'e403ec140fbd15d653763ed0e271a76ae512ad6f523f1b3168f134fdfe92c1dd',
  },
  'linux-arm64-glibc': {
    file: 'squawk-linux-arm64',
    sha256: '04455267bb895de1568dc24e52eb062b311096ad614c3e15a77cf8a7b3483c2a',
  },
  'linux-arm64-musl': {
    file: 'squawk-linux-musl-arm64',
    sha256: '59e83fedf6993db755e1574285620268b799b51232204aff6cb99413ab53e9f2',
  },
  'darwin-arm64': {
    file: 'squawk-darwin-arm64',
    sha256: 'd273f3a234b81b8d540b2cdf1b07ed84f719a3ab11b47d6f3efe96baaf21b40b',
  },
  'darwin-x64': {
    file: 'squawk-darwin-x64',
    sha256: 'e361365762a6bf11abbef746d29ff46ac0b4feba43df2f0570595f06c67d7daf',
  },
  'win32-x64': {
    file: 'squawk-windows-x64.exe',
    sha256: '36824c446ba3348c4037a33f9ab10427de03d553ea67b482ac3a098248203dc2',
  },
}
const MIGRATIONS = 'drizzle'
const CONFIG = '.squawk.toml'

const platform = () => {
  if (process.platform !== 'linux') return `${process.platform}-${process.arch}`
  const report = process.report.getReport() as { header?: { glibcVersionRuntime?: string } }
  return `linux-${process.arch}-${report.header?.glibcVersionRuntime ? 'glibc' : 'musl'}`
}

const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

/** The cached binary, downloaded and verified on first use. */
const squawk = async () => {
  const asset = ASSETS[platform()]
  if (!asset) throw new Error(`no pinned squawk ${VERSION} binary for ${platform()}`)
  const dir = join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'proofstack', `squawk-${VERSION}`)
  const binary = join(dir, asset.file)
  if (existsSync(binary) && digest(readFileSync(binary)) === asset.sha256) return binary
  const url = `https://github.com/sbdchd/squawk/releases/download/v${VERSION}/${asset.file}`
  console.log(`downloading squawk ${VERSION} (${asset.file}) into ${dir}`)
  const response = await fetch(url).catch((error: unknown) => {
    throw new Error(`cannot download ${url} (the first run needs the network): ${String(error)}`)
  })
  if (!response.ok) throw new Error(`cannot download ${url}: HTTP ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (digest(bytes) !== asset.sha256)
    throw new Error(`${url} has sha256 ${digest(bytes)}, expected ${asset.sha256}; refusing to run it`)
  mkdirSync(dir, { recursive: true })
  const partial = `${binary}.${process.pid}.partial`
  writeFileSync(partial, bytes)
  chmodSync(partial, 0o755)
  renameSync(partial, binary)
  return binary
}

/** The grandfathered files: the quoted paths inside `excluded_paths = [...]`. */
const excluded = new Set(
  [...(/^excluded_paths\s*=\s*\[([^\]]*)\]/m.exec(readFileSync(CONFIG, 'utf8'))?.[1] ?? '').matchAll(/"([^"]+)"/g)].map(
    (match) => match[1] ?? '',
  ),
)

const problems: string[] = []
let binary: string
try {
  binary = await squawk()
} catch (error) {
  console.error(`check:migrations: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
type Finding = { file: string; line: number; rule_name: string; message: string; help?: string | null }
/** squawk's findings; its JSON lines are 0-based. Undefined when it fails without a report. */
const lint = (files: string[], input?: string) => {
  const result = spawnSync(binary, ['--config', CONFIG, '--reporter', 'json', ...files], {
    encoding: 'utf8',
    input,
    stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
  })
  try {
    return (JSON.parse(result.stdout) as Finding[]).map(
      (f) => `${f.file}:${f.line + 1}: ${f.rule_name}: ${f.message}${f.help ? `\n      ${f.help}` : ''}`,
    )
  } catch {
    problems.push(`squawk failed (exit ${result.status}): ${`${result.stdout}${result.stderr}`.trim()}`)
    return undefined
  }
}

// Self-test: a plain CREATE INDEX on an existing table must be flagged with this configuration.
const selfTest = lint(['--stdin-filepath', `${MIGRATIONS}/9999_self_test.sql`], 'CREATE INDEX "a" ON "post" ("id");\n')
if (selfTest && !selfTest.some((finding) => finding.includes('require-concurrent-index-creation')))
  problems.push('squawk did not flag a non-concurrent CREATE INDEX: check .squawk.toml')

const files = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith('.sql'))
  .toSorted()
  .map((name) => `${MIGRATIONS}/${name}`)
const linted = files.filter((file) => !excluded.has(file))
for (const file of excluded)
  if (!files.includes(file)) problems.push(`${CONFIG}: excluded path ${file} does not exist anymore`)

// A waiver names its reason in the comment line right above it.
for (const file of linted) {
  const lines = readFileSync(file, 'utf8').split('\n')
  lines.forEach((line, index) => {
    if (!/^\s*--\s*squawk-ignore/.test(line)) return
    const above = lines[index - 1] ?? ''
    if (!/^\s*--\s*\S/.test(above) || above.includes('squawk-ignore'))
      problems.push(`${file}:${index + 1}: a squawk-ignore needs its reason in a comment on the line above`)
  })
}

if (linted.length) problems.push(...(lint(linted) ?? []))

if (problems.length) {
  console.error(`check:migrations failed:\n${problems.map((p) => `  - ${p}`).join('\n')}`)
  console.error(
    '\nMake the migration safe (docs/operations.md, "Migration safety"): split it, build indexes CONCURRENTLY ' +
      'by hand before the deploy, or waive one statement with `-- squawk-ignore <rule>` under a comment that ' +
      'says why. Rules: https://squawkhq.com/docs/rules',
  )
  process.exitCode = 1
} else
  console.log(
    `ok    squawk ${VERSION}: ${linted.length ? linted.join(', ') : 'no migrations after the grandfathered ones'} ` +
      `(${excluded.size} grandfathered)`,
  )
