// What the Lighthouse gate (scripts/lighthouse.ts) reports: lighthouse-report/summary.{json,md}, the GitHub step
// summary, the console, and the exit code (0 pass, 1 fail, 2 inconclusive).
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { join } from 'node:path'
import {
  type Category,
  type FormFactor,
  type Metric,
  PAGES,
  POLICY,
  REPORTED,
  type Verdict,
} from './lighthouse-policy.ts'
import { LANTERN_TASK_THRESHOLD_MS, type RunsSummary, type ScoreRange } from './lighthouse-runs.ts'

/** One page and form factor, as summary.json lists it. */
export type PageOutcome = {
  page: string
  path: string
  formFactor: FormFactor
  runs: number
  verdict: Verdict
  scores: Record<Category, ScoreRange | null>
  metrics: Record<Metric, number>
  problems: string[]
  medianRun: number
  perRun: RunsSummary['perRun']
  failingAudits: string[]
}

/** How the pages were reached: the Node server directly, or through the edge over `edge` (h2, h1, http). */
export type Setup = { runs: number; edge: false | string; shmBytes: number }

/** One console line per page and form factor, as it is measured. */
export const progressLine = (outcome: PageOutcome): string => {
  const scores = REPORTED.map((category) => `${category}=${outcome.scores[category]?.median ?? '-'}`).join(' ')
  const performance = outcome.perRun.map((run) => run.scores.performance).join(',')
  const indexes = outcome.perRun.map((run) => run.benchmarkIndex).join(',')
  const preload = outcome.perRun.map((run) => run.preloadTaskMs ?? '-').join(',')
  return `${outcome.verdict.toUpperCase().padEnd(12)} ${outcome.page} ${outcome.formFactor} ${scores} perf runs ${performance} benchmarkIndex ${indexes} preload task ms ${preload}`
}

/** `median (min–max)`, with `*` for a category the page reports but does not gate. */
const formatScore = (range: ScoreRange | null, gated: boolean): string => {
  if (!range) return '–'
  const spread = range.min === range.max ? '' : ` (${range.min}–${range.max})`
  return `${range.median}${spread}${gated ? '' : '*'}`
}

const tableRow = (outcome: PageOutcome): string => {
  const gated = PAGES.find((page) => page.name === outcome.page)?.gated ?? []
  const cells = REPORTED.map((category) => formatScore(outcome.scores[category], gated.includes(category)))
  const { fcp, lcp, tbt, cls, bytes } = outcome.metrics
  const timings = `${Math.round(fcp)} ms | ${Math.round(lcp)} ms | ${Math.round(tbt)} ms | ${cls.toFixed(3)}`
  const problems = outcome.problems.length ? `: ${outcome.problems.join('; ')}` : ''
  return `| ${outcome.path} | ${outcome.formFactor} | ${cells.join(' | ')} | ${timings} | ${Math.round(bytes / 1024)} KiB | ${outcome.verdict}${problems} |`
}

/**
 * A line on the host when a mobile run's preload task reached Lantern's threshold: from there the simulated FCP and
 * LCP include four times that task, so they measure the host's CPU contention as much as the page (ADR 0011).
 * Desktop runs are left out: their CPU slowdown is 1, so the task adds only its own length.
 */
const contendedHostNote = (outcomes: PageOutcome[]): string => {
  const tasks = outcomes
    .filter((outcome) => outcome.formFactor === 'mobile')
    .flatMap((outcome) => outcome.perRun.map((run) => run.preloadTaskMs ?? 0))
  const longest = Math.max(0, ...tasks)
  if (longest < LANTERN_TASK_THRESHOLD_MS) return ''
  const counted = tasks.filter((ms) => ms >= LANTERN_TASK_THRESHOLD_MS).length
  return (
    ` Preload task >= ${LANTERN_TASK_THRESHOLD_MS} ms in ${counted} of ${tasks.length} mobile runs (up to ${longest} ms): ` +
    'Lantern adds four times it before every preloaded script, so FCP and LCP grow with the CPU contention of ' +
    'this host (ADR 0011).'
  )
}

const tableIntro = (outcomes: PageOutcome[], setup: Setup): string => {
  const { version } = JSON.parse(readFileSync('node_modules/lighthouse/package.json', 'utf8')) as { version: string }
  const indexes = outcomes.flatMap((outcome) => outcome.perRun.map((run) => run.benchmarkIndex))
  const through = setup.edge === false ? 'Node server without the edge' : `through the Caddy edge (${setup.edge})`
  return (
    `Lighthouse ${version}, median of ${setup.runs} runs, ${through}. ` +
    `benchmarkIndex ${Math.min(...indexes)}–${Math.max(...indexes)}, ${availableParallelism()} CPUs.` +
    contendedHostNote(outcomes) +
    ' * = reported, not gated. Diagnose with `<page>-<form factor>-median.report.html` (Lighthouse median run).'
  )
}

/** The Markdown summary: a line on how it was measured, then one row per page and form factor. */
const summaryTable = (outcomes: PageOutcome[], setup: Setup): string =>
  [
    tableIntro(outcomes, setup),
    '',
    '| Page | Form factor | Perf | A11y | Best pr. | SEO | Agentic | FCP | LCP | TBT | CLS | Bytes | Result |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...outcomes.map((outcome) => tableRow(outcome)),
  ].join('\n')

/** Writes summary.json and summary.md to `outputDir`, the GitHub step summary, and the table to the console. */
export const writeReport = (outcomes: PageOutcome[], setup: Setup & { outputDir: string }): void => {
  const table = summaryTable(outcomes, setup)
  const summary = {
    policy: POLICY,
    edge: setup.edge,
    shmBytes: setup.shmBytes,
    cpus: availableParallelism(),
    // `results` is summary.json's key for the pages, which people and CI artifacts read; the rule is about names in code.
    // oxlint-disable-next-line eslint/id-denylist
    results: outcomes,
  }
  writeFileSync(join(setup.outputDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  writeFileSync(join(setup.outputDir, 'summary.md'), `${table}\n`)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Lighthouse\n\n${table}\n`)
  console.log(`\n${table}\n`)
  for (const outcome of outcomes.filter(({ failingAudits }) => failingAudits.length))
    console.log(
      `${outcome.page} ${outcome.formFactor} audits below 1 (median run ${outcome.medianRun}):\n  ` +
        outcome.failingAudits.join('\n  '),
    )
}

/** 1 when a page failed; else 2 when one was inconclusive (with the reason on stderr); else 0. */
export const exitCodeOf = (outcomes: PageOutcome[]): number => {
  const verdicts = new Set(outcomes.map((outcome) => outcome.verdict))
  if (verdicts.has('fail')) return 1
  if (!verdicts.has('inconclusive')) return 0
  console.error('\nInconclusive: this machine measured too slow for the performance score to mean anything (exit 2).')
  return 2
}
