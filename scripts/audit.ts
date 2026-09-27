import { readAllowlist } from './allowlist.ts'
// Vulnerability gate over every installed package, production and development: `pnpm audit --json`
// (the npm advisory database, GitHub advisories). Fails on a high or critical advisory unless
// security/audit-allowlist.json accepts it; lists moderate and low ones without failing. Also fails on an
// allowlist entry that is malformed, expired, or no longer matches an advisory, so the list only holds
// decisions that still apply. GitHub's dependency graph cannot read pnpm 12 lockfiles yet
// (dependabot/dependabot-core#15904), so Dependabot security alerts miss this project: this is the gate.
// Usage: pnpm audit:check   (needs the npm registry; CI job `supply-chain`)
import { pnpmInvocation, runSync } from './spawn.ts'

const ALLOWLIST = 'security/audit-allowlist.json'
const BLOCKING = new Set(['high', 'critical'])

type Advisory = {
  github_advisory_id: string
  module_name: string
  severity: string
  title: string
  url: string
  patched_versions: string | null
  findings: Array<{ version: string; paths: string[] }>
}

const { entries, problems } = readAllowlist(ALLOWLIST, 'advisories', 'ghsa', /^GHSA(-[23456789cfghjmpqrvwx]{4}){3}$/)

const audit = runSync(pnpmInvocation(['audit', '--json']), { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
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

const allowed = (advisory: Advisory) =>
  entries.find((entry) => entry.id === advisory.github_advisory_id && entry.name === advisory.module_name)

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
    problems.push(`${ALLOWLIST}: ${entry.id} in ${entry.name} matches no advisory anymore; remove the entry`)

const counts = ORDER.map((s) => [s, advisories.filter((a) => a.severity === s).length] as const).filter(([, n]) => n)
console.log(
  `\n${advisories.length} advisories${counts.length ? ` (${counts.map(([s, n]) => `${n} ${s}`).join(', ')})` : ''}, ` +
    `${advisories.filter((advisory) => allowed(advisory)).length} allowlisted`,
)
if (problems.length) {
  console.error(`\npnpm audit:check failed:\n${problems.map((p) => `  - ${p}`).join('\n')}`)
  console.error(
    '\nFix a vulnerable package by upgrading its parent, or with an exact `overrides` entry in pnpm-workspace.yaml ' +
      `(\`pnpm why <package>\`). If it cannot apply here, add it to ${ALLOWLIST} with the reason and an expiry date.`,
  )
  process.exitCode = 1
}
