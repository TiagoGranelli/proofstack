// Dependency freshness report, never a gate: exits 0 whatever it finds (upgrades follow AGENTS.md "Version
// policy", one PR per pre-release package). Two tables:
// - `pnpm outdated`: every dependency with a newer release pnpm would install. Like `pnpm install`, it skips
//   releases younger than pnpm's minimumReleaseAge quarantine (pnpm-workspace.yaml).
// - Channels: packages pinned from an npm dist-tag other than `latest`. `pnpm outdated` compares them with
//   `latest`, which is the wrong line for them, so they are compared with their own dist-tag instead
//   (`npm view <pkg> dist-tags time`).
// Usage: pnpm deps:check   (needs the npm registry)
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { table } from './report-table.ts'

/** Packages pinned from a dist-tag other than `latest`, and why. */
const CHANNELS: Record<string, { tag: string; why: string }> = {
  effect: { tag: 'rc', why: 'Effect v4; `latest` is v3 (AGENTS.md, "Effect v4 RC")' },
  '@effect/vitest': { tag: 'rc', why: 'released with effect' },
  '@hey-api/openapi-ts': { tag: 'next', why: '0.99.0 crashes on TS 7 (ADR 0002)' },
}

const DAY_MS = 24 * 60 * 60 * 1000

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
const outdatedRows = Object.entries(outdated ?? {})
  .filter(([name]) => !(name in CHANNELS))
  .toSorted(([a], [b]) => a.localeCompare(b))
  .map(([name, info]) => [name, info.current ?? '?', info.wanted ?? '?', info.latest ?? '?', info.dependencyType ?? ''])

console.log('pnpm outdated (without the channel packages below; the minimumReleaseAge quarantine applies)\n')
if (!outdated) console.log('  not available, see below')
else if (outdatedRows.length === 0) console.log('  Every dependency is on the newest release pnpm would install.')
else console.log(table(['Package', 'Current', 'Wanted', 'Latest', 'Type'], outdatedRows))

const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}
const pinned = (name: string) =>
  manifest.dependencies?.[name] ?? manifest.devDependencies?.[name] ?? '(not a dependency)'

const channelRows = Object.entries(CHANNELS).map(([name, { tag, why }]) => {
  const view = spawnSync('npm', ['view', name, 'dist-tags', 'time', '--json'], { encoding: 'utf8' })
  let info: { 'dist-tags'?: Record<string, string>; time?: Record<string, string> } | undefined
  try {
    info = JSON.parse(view.stdout) as typeof info
  } catch {
    problems.push(`npm view ${name} failed: ${(view.stderr || view.stdout).trim()}`)
  }
  const tagged = info?.['dist-tags']?.[tag]
  const published = tagged ? info?.time?.[tagged] : undefined
  const age = published ? `${Math.floor((Date.now() - Date.parse(published)) / DAY_MS)} d` : '?'
  const status = !tagged ? 'unknown' : tagged === pinned(name) ? 'up to date' : `newer: ${tagged}`
  return [name, pinned(name), `${tag} ${tagged ?? '?'}`, age, info?.['dist-tags']?.latest ?? '?', status, why]
})

console.log('\nChannels (pinned from a dist-tag other than `latest`)\n')
console.log(table(['Package', 'Pinned', 'Dist-tag', 'Age', 'latest', 'Status', 'Why'], channelRows))

if (problems.length) {
  console.log('\nIncomplete report (not a failure):')
  for (const problem of problems) console.log(`  ${problem}`)
}
console.log(
  '\nReport only. Upgrade pre-release packages in their own PR with check, check:drift and verify:app passing ' +
    '(AGENTS.md, "Version policy"); a release inside the quarantine needs an exact minimumReleaseAgeExclude entry.',
)
