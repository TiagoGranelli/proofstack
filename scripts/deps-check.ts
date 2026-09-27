// Dependency freshness report, never a gate: exits 0 whatever it finds (upgrades follow AGENTS.md "Version
// policy", one PR per RC or beta package). Two tables:
// - `pnpm outdated`: every dependency with a newer release pnpm would install. Like `pnpm install`, it skips
//   releases younger than pnpm's minimumReleaseAge quarantine (pnpm-workspace.yaml).
// - The RC channel: packages whose npm `latest` is an older major, so `pnpm outdated` cannot see their next
//   release. They are compared with their `rc` dist-tag (`npm view <pkg> dist-tags time`).
// Usage: pnpm deps:check   (needs the npm registry)
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

/** Pinned from the `rc` dist-tag: `effect@latest` is still v3 (AGENTS.md, "Effect v4 RC"). */
const RC_CHANNEL = ['effect', '@effect/vitest']

const DAY_MS = 24 * 60 * 60 * 1000

const table = (header: string[], rows: string[][]) => {
  const widths = header.map((cell, i) => Math.max(cell.length, ...rows.map((row) => row[i]!.length)))
  const line = (row: string[]) =>
    row
      .map((cell, i) => cell.padEnd(widths[i]!))
      .join('  ')
      .trimEnd()
  return [line(header), line(widths.map((w) => '-'.repeat(w))), ...rows.map(line)].join('\n')
}

const problems: string[] = []

// pnpm outdated exits 1 when it finds something; its JSON is on stdout either way.
type Outdated = Record<string, { current?: string; wanted?: string; latest?: string; dependencyType?: string }>
const outdatedRun = spawnSync('pnpm', ['outdated', '--format', 'json'], { encoding: 'utf8' })
let outdated: Outdated | undefined
try {
  outdated = JSON.parse(outdatedRun.stdout || '{}') as Outdated
} catch {
  problems.push(`pnpm outdated failed: ${(outdatedRun.stderr || outdatedRun.stdout).trim()}`)
}

console.log('pnpm outdated (releases inside the minimumReleaseAge quarantine are not listed)\n')
if (!outdated) console.log('  not available, see below')
else if (Object.keys(outdated).length === 0)
  console.log('  Every dependency is on the newest release pnpm would install.')
else
  console.log(
    table(
      ['Package', 'Current', 'Wanted', 'Latest', 'Type'],
      Object.entries(outdated)
        .toSorted(([a], [b]) => a.localeCompare(b))
        .map(([name, info]) => [
          name,
          info.current ?? '?',
          info.wanted ?? '?',
          info.latest ?? '?',
          info.dependencyType ?? '',
        ]),
    ),
  )

const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}
const pinned = (name: string) =>
  manifest.dependencies?.[name] ?? manifest.devDependencies?.[name] ?? '(not a dependency)'

const rcRows = RC_CHANNEL.map((name) => {
  const view = spawnSync('npm', ['view', name, 'dist-tags', 'time', '--json'], { encoding: 'utf8' })
  let info: { 'dist-tags'?: Record<string, string>; time?: Record<string, string> } | undefined
  try {
    info = JSON.parse(view.stdout) as typeof info
  } catch {
    problems.push(`npm view ${name} failed: ${(view.stderr || view.stdout).trim()}`)
  }
  const rc = info?.['dist-tags']?.rc
  const latest = info?.['dist-tags']?.latest ?? '?'
  const published = rc ? info?.time?.[rc] : undefined
  const age = published ? `${Math.floor((Date.now() - Date.parse(published)) / DAY_MS)} d` : '?'
  const status = !rc ? 'unknown' : rc === pinned(name) ? 'up to date' : `newer RC ${rc}`
  return [name, pinned(name), rc ?? '?', age, latest, status]
})

console.log('\nRC channel (npm dist-tag `rc`; `latest` is an older major)\n')
console.log(table(['Package', 'Pinned', 'rc', 'rc age', 'latest', 'Status'], rcRows))

if (problems.length) {
  console.log('\nIncomplete report (not a failure):')
  for (const problem of problems) console.log(`  ${problem}`)
}
console.log(
  '\nReport only. Upgrade RC and beta packages in their own PR with check, check:drift and verify:app passing ' +
    '(AGENTS.md, "Version policy"); a release inside the quarantine needs an exact minimumReleaseAgeExclude entry.',
)
