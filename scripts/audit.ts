// Vulnerability gate over every installed package, production and development: `pnpm audit --json`
// (the npm advisory database, GitHub advisories). Fails on a high or critical advisory unless
// security/audit-allowlist.json accepts it; lists moderate and low ones without failing. Also fails on an
// allowlist entry that is malformed, expired, or no longer matches an advisory, so the list only holds
// decisions that still apply. GitHub's dependency graph cannot read pnpm 12 lockfiles yet
// (dependabot/dependabot-core#15904), so Dependabot security alerts miss this project: this is the gate.
// Usage: pnpm audit:check   (needs the npm registry; CI job `supply-chain`)
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const ALLOWLIST = 'security/audit-allowlist.json'
const BLOCKING = new Set(['high', 'critical'])
const MAX_DAYS = 180
const DAY_MS = 24 * 60 * 60 * 1000

type Advisory = {
  github_advisory_id: string
  module_name: string
  severity: string
  title: string
  url: string
  patched_versions: string | null
  findings: Array<{ version: string; paths: string[] }>
}
type Entry = { ghsa?: unknown; package?: unknown; reason?: unknown; expires?: unknown }

const problems: string[] = []

const audit = spawnSync('pnpm', ['audit', '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
let advisories: Advisory[] = []
try {
  // pnpm audit exits 1 when it finds anything; the report is on stdout either way.
  const report = JSON.parse(audit.stdout) as { advisories?: Record<string, Advisory> }
  if (!report.advisories) throw new Error('no `advisories` in the report')
  advisories = Object.values(report.advisories)
} catch (error) {
  console.error(`pnpm audit did not produce a report (${error instanceof Error ? error.message : String(error)}):`)
  console.error((audit.stderr || audit.stdout).trim())
  process.exit(1)
}

const allowlist = (JSON.parse(readFileSync(ALLOWLIST, 'utf8')) as { advisories?: Entry[] }).advisories ?? []
const today = new Date().toISOString().slice(0, 10)
const entries = allowlist.flatMap((entry, index) => {
  const where = `${ALLOWLIST} entry ${index + 1}`
  const { ghsa, package: name, reason, expires } = entry
  if (typeof ghsa !== 'string' || !/^GHSA(-[23456789cfghjmpqrvwx]{4}){3}$/.test(ghsa))
    problems.push(`${where}: \`ghsa\` must be a GHSA id`)
  else if (typeof name !== 'string' || !name) problems.push(`${where}: \`package\` is required`)
  else if (typeof reason !== 'string' || reason.trim().length < 20)
    problems.push(`${where} (${ghsa}): \`reason\` must say why the advisory does not apply`)
  else if (typeof expires !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(expires) || Number.isNaN(Date.parse(expires)))
    problems.push(`${where} (${ghsa}): \`expires\` must be a YYYY-MM-DD date`)
  else if (expires < today) problems.push(`${where} (${ghsa} in ${name}): expired on ${expires}; review it again`)
  else if (Date.parse(expires) - Date.parse(today) > MAX_DAYS * DAY_MS)
    problems.push(`${where} (${ghsa} in ${name}): expires more than ${MAX_DAYS} days ahead`)
  else return [{ ghsa, name, expires }]
  return []
})

const allowed = (advisory: Advisory) =>
  entries.find((entry) => entry.ghsa === advisory.github_advisory_id && entry.name === advisory.module_name)

const ORDER = ['critical', 'high', 'moderate', 'low', 'info']
const sorted = advisories.toSorted((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity))
for (const advisory of sorted) {
  const entry = allowed(advisory)
  const versions = [...new Set(advisory.findings.map((f) => f.version))].join(', ')
  const paths = [...new Set(advisory.findings.flatMap((f) => f.paths))]
  const status = entry ? `allowed until ${entry.expires}` : BLOCKING.has(advisory.severity) ? 'FAIL' : 'not blocking'
  console.log(
    `${advisory.severity.padEnd(8)} ${advisory.module_name}@${versions}  ${advisory.github_advisory_id}  ${status}`,
  )
  console.log(`         ${advisory.title}`)
  console.log(`         fixed in ${advisory.patched_versions ?? 'no release yet'}; via ${paths[0] ?? '?'}`)
  if (paths.length > 1) console.log(`         and ${paths.length - 1} more path(s)`)
  if (!entry && BLOCKING.has(advisory.severity))
    problems.push(`${advisory.severity} ${advisory.github_advisory_id} in ${advisory.module_name}@${versions}`)
}
for (const entry of entries)
  if (!advisories.some((advisory) => allowed(advisory) === entry))
    problems.push(`${ALLOWLIST}: ${entry.ghsa} in ${entry.name} matches no advisory anymore; remove the entry`)

const counts = ORDER.map((s) => [s, advisories.filter((a) => a.severity === s).length] as const).filter(([, n]) => n)
console.log(
  `\n${advisories.length} advisories${counts.length ? ` (${counts.map(([s, n]) => `${n} ${s}`).join(', ')})` : ''}, ` +
    `${advisories.filter(allowed).length} allowlisted`,
)
if (problems.length) {
  console.error(`\npnpm audit:check failed:\n${problems.map((p) => `  - ${p}`).join('\n')}`)
  console.error(
    '\nFix a vulnerable package by upgrading its parent, or with an exact `overrides` entry in pnpm-workspace.yaml ' +
      `(\`pnpm why <package>\`). If it cannot apply here, add it to ${ALLOWLIST} with the reason and an expiry date.`,
  )
  process.exitCode = 1
}
