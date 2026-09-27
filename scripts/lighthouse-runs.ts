// Runs of the Lighthouse CLI for the gate (scripts/lighthouse.ts) with Playwright's Chromium, and what the gate
// reads from their reports: scores, metric medians, failing audits and the median run.
import { copyFileSync, existsSync, readFileSync, statfsSync } from 'node:fs'
import { computeMedianRun } from 'lighthouse/core/lib/median-run.js'
import { xSync } from 'tinyexec'
import { type Category, type FormFactor, type Measured, type Metric, median, REPORTED } from './lighthouse-policy.ts'

/** The parts of a Lighthouse report (LHR) the gate reads. */
export type Lhr = {
  finalDisplayedUrl: string
  runtimeError?: { message: string }
  runWarnings: string[]
  environment: { benchmarkIndex: number }
  categories: Record<string, { score: number | null; auditRefs: { id: string; weight: number }[] }>
  audits: Record<
    string,
    {
      score: number | null
      numericValue?: number
      scoreDisplayMode: string
      title: string
      details?: { items?: Record<string, unknown>[] }
    }
  >
}

const METRIC_AUDITS: Record<Metric, string> = {
  fcp: 'first-contentful-paint',
  lcp: 'largest-contentful-paint',
  tbt: 'total-blocking-time',
  cls: 'cumulative-layout-shift',
  si: 'speed-index',
  bytes: 'total-byte-weight',
}

/** Playwright's Chromium (or CHROME_PATH), or a clear instruction to install it. */
export const findChromium = async (): Promise<string> => {
  const { chromium } = await import('@playwright/test')
  const path = process.env.CHROME_PATH ?? chromium.executablePath()
  if (!existsSync(path))
    throw new Error(`Chromium for Playwright is not installed (${path}). Run: pnpm exec playwright install chromium`)
  return path
}

// Chrome keeps shared memory in /dev/shm, which is 64 MB in a default Docker container: renderers crash or
// stall there and the timings suffer. Below 1 GiB Chrome is told to use /tmp instead (slower, but stable).
const sharedMemoryBytes = (): number => {
  try {
    const stats = statfsSync('/dev/shm')
    return stats.blocks * stats.bsize
  } catch {
    return 0
  }
}
export const SHM_BYTES = sharedMemoryBytes()
export const SMALL_SHM = SHM_BYTES < 1024 ** 3

/**
 * Chrome's flags. `edgeCertificateSpki`: Chrome trusts exactly the key of the edge's local certificate (not every
 * certificate error), so the page is a secure https origin as in production, and best-practices audits see what
 * users would see. `http1`: HTTP/1.1 only, to compare with HTTP/2.
 */
export const chromeFlags = (options: { edgeCertificateSpki?: string; http1: boolean }): string[] => [
  '--headless=new',
  '--no-sandbox',
  ...(SMALL_SHM ? ['--disable-dev-shm-usage'] : []),
  ...(options.edgeCertificateSpki ? [`--ignore-certificate-errors-spki-list=${options.edgeCertificateSpki}`] : []),
  ...(options.http1 ? ['--disable-http2', '--disable-quic'] : []),
]

export type Chrome = { path: string; flags: string[] }

type LighthouseRun = {
  url: string
  formFactor: FormFactor
  /** Where the reports go: `<outputBase>.report.{json,html}`. */
  outputBase: string
  cookie: string | undefined
  chrome: Chrome
}

/** One Lighthouse run of every REPORTED category; returns its report. */
export const runLighthouse = (run: LighthouseRun): Lhr => {
  const args = ['exec', 'lighthouse', run.url, '--output=json', '--output=html', `--output-path=${run.outputBase}`]
    .concat([`--only-categories=${REPORTED.join(',')}`, `--chrome-flags=${run.chrome.flags.join(' ')}`, '--quiet'])
    .concat(run.formFactor === 'desktop' ? ['--preset=desktop'] : [])
    .concat(run.cookie ? [`--extra-headers=${JSON.stringify({ cookie: run.cookie })}`] : [])
  const lighthouse = xSync('pnpm', args, {
    timeout: 180_000,
    nodeOptions: { stdio: 'inherit', env: { CHROME_PATH: run.chrome.path } },
  })
  if (lighthouse.exitCode !== 0)
    throw new Error(
      `lighthouse failed for ${run.url} (${run.formFactor}): exit ${lighthouse.exitCode ?? lighthouse.signalCode}, ` +
        'expected 0 (its output is above)',
    )
  return JSON.parse(readFileSync(`${run.outputBase}.report.json`, 'utf8')) as Lhr
}

export const score = (lhr: Lhr, category: Category): number | null => {
  const value = lhr.categories[category]?.score
  return value == null ? null : Math.round(value * 100)
}

export type ScoreRange = { median: number; min: number; max: number }

const scoreRange = (lhrs: Lhr[], category: Category): ScoreRange | null => {
  const values = lhrs.map((lhr) => score(lhr, category)).filter((value): value is number => value !== null)
  return values.length ? { median: median(values), min: Math.min(...values), max: Math.max(...values) } : null
}

const byCategory = <T>(value: (category: Category) => T): Record<Category, T> =>
  Object.fromEntries(REPORTED.map((category) => [category, value(category)])) as Record<Category, T>

const metricMedians = (lhrs: Lhr[]): Record<Metric, number> =>
  Object.fromEntries(
    Object.entries(METRIC_AUDITS).map(([metric, audit]) => [
      metric,
      median(lhrs.map((lhr) => lhr.audits[audit]?.numericValue ?? Number.NaN)),
    ]),
  ) as Record<Metric, number>

/**
 * Lantern keeps a main-thread task in its simulation only from this duration up; shorter ones are pruned and cost
 * nothing (`SIGNIFICANT_DUR_THRESHOLD_MS` in @paulirish/trace_engine's lantern/graph/PageDependencyGraph.js).
 */
export const LANTERN_TASK_THRESHOLD_MS = 10

const numberIn = (entry: Record<string, unknown>, key: string): number | undefined => {
  const value = entry[key]
  return typeof value === 'number' ? value : undefined
}

/**
 * How long the main-thread task ran that requested the page's first stylesheet or script: Chrome's navigation
 * commit, which also creates the page's JavaScript contexts. From LANTERN_TASK_THRESHOLD_MS up, Lantern makes
 * every preloaded script wait for it, times the CPU slowdown (4 on mobile), so the simulated mobile FCP and LCP
 * grow on a contended host (ADR 0011). Null when the report does not show it.
 */
export const preloadTaskMs = (lhr: Lhr): number | null => {
  const requests = lhr.audits['network-requests']?.details?.items ?? []
  const first = requests.find((request) => request.resourceType === 'Stylesheet' || request.resourceType === 'Script')
  const sentAt = first && numberIn(first, 'rendererStartTime')
  if (sentAt === undefined) return null
  const tasks = lhr.audits['main-thread-tasks']?.details?.items ?? []
  const sender = tasks.find((task) => {
    const start = numberIn(task, 'startTime') ?? Number.NaN
    return start <= sentAt && sentAt <= start + (numberIn(task, 'duration') ?? Number.NaN)
  })
  const duration = sender && numberIn(sender, 'duration')
  return duration === undefined ? null : Math.round(duration * 10) / 10
}

export type RunsSummary = Measured & { scores: Record<Category, ScoreRange | null> }

/** What the runs of one page and form factor measured: each category's range, each metric's median, each run. */
export const summarizeRuns = (lhrs: Lhr[]): RunsSummary => ({
  scores: byCategory((category) => scoreRange(lhrs, category)),
  metrics: metricMedians(lhrs),
  perRun: lhrs.map((lhr, index) => ({
    run: index + 1,
    benchmarkIndex: Math.round(lhr.environment.benchmarkIndex),
    runWarnings: lhr.runWarnings,
    preloadTaskMs: preloadTaskMs(lhr),
    scores: byCategory((category) => score(lhr, category)),
  })),
})

const counts = (audit: Lhr['audits'][string]) =>
  audit.scoreDisplayMode !== 'notApplicable' &&
  audit.scoreDisplayMode !== 'informative' &&
  audit.score !== null &&
  audit.score < 1

/** Weighted audits of `categories` that did not pass, as `category: title (score)`, without repeats. */
export const failingAudits = (lhr: Lhr, categories: Category[]): string[] => [
  ...new Set(
    categories.flatMap((category) =>
      (lhr.categories[category]?.auditRefs ?? [])
        .filter((ref) => ref.weight > 0)
        .flatMap((ref) => lhr.audits[ref.id] ?? [])
        .filter((audit) => counts(audit))
        .map((audit) => `${category}: ${audit.title} (${audit.score})`),
    ),
  ),
]

/**
 * Lighthouse's own median-run selection (closest to the median FCP and TTI) picks the report to read; its HTML
 * report is copied to `<prefix>-median.report.html`. Returns that run and its number (from 1).
 */
export const keepMedianReport = (lhrs: Lhr[], prefix: string): { medianLhr: Lhr; medianRun: number } => {
  const medianLhr = computeMedianRun(lhrs as never) as unknown as Lhr
  const medianRun = lhrs.indexOf(medianLhr) + 1
  copyFileSync(`${prefix}-${medianRun}.report.html`, `${prefix}-median.report.html`)
  return { medianLhr, medianRun }
}
