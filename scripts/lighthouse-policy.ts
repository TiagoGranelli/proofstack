// What the Lighthouse gate (scripts/lighthouse.ts) measures and demands: the pages, the categories gated on each,
// and POLICY, which turns the runs of one page and form factor into a verdict.

export type Category = 'performance' | 'accessibility' | 'best-practices' | 'seo' | 'agentic-browsing'
export type FormFactor = 'mobile' | 'desktop'
export type Metric = 'fcp' | 'lcp' | 'tbt' | 'cls' | 'si' | 'bytes'

const GATED: Category[] = ['performance', 'accessibility', 'best-practices', 'seo']
// Lighthouse 13.5 category; reported but not gated while its audits (llms.txt, WebMCP) are experimental.
export const REPORTED: Category[] = [...GATED, 'agentic-browsing']

export type Page = { name: string; path: string; auth?: boolean; gated: Category[] }

export const PAGES: Page[] = [
  { name: 'home', path: '/', gated: GATED },
  { name: 'about', path: '/about', gated: GATED },
  // noindex by design (nothing to find there), so SEO does not apply.
  { name: 'login', path: '/login', gated: ['performance', 'accessibility', 'best-practices'] },
  // Private and noindex by design, so SEO does not apply.
  { name: 'dashboard', path: '/dashboard', auth: true, gated: ['performance', 'accessibility', 'best-practices'] },
]

export const POLICY = {
  /**
   * Categories whose audits are deterministic (DOM, headers, console): every run must score exactly this.
   * A single lower run is a real defect, not noise.
   */
  deterministic: { categories: ['accessibility', 'best-practices', 'seo'] as Category[], everyRun: 100 },
  /**
   * The performance score comes from simulated throttling over a real trace, and simulated mobile FCP/LCP
   * move in ~150 ms steps, so single runs vary by a point or two. Judged by the median, with at most
   * `maxRunsBelow100` imperfect runs and none below `minRun`.
   * - `target`, the project's bar, applies by default (`pnpm lighthouse`).
   * - `ci` (`--bar=ci`, `pnpm ci:lighthouse`): on GitHub's 2-vCPU runners a Chrome task passes Lantern's 10 ms
   *   cutoff and every mobile run of an unchanged page scores 99 (GoogleChrome/lighthouse#16539, ADR 0011). The
   *   bar there is no run below 95; the budgets and the other categories stay as strict. Back to `target`
   *   once Lighthouse stops counting modulepreloads in FCP.
   */
  performance: {
    target: { minMedian: 99, maxRunsBelow100: 1, minRun: 95 },
    ci: { minMedian: 95, maxRunsBelow100: Number.POSITIVE_INFINITY, minRun: 95 },
  },
  /**
   * Hard budgets on the medians (ms, unitless CLS, bytes): a backstop ~30-50% above the measured values.
   * The score gate above is the tighter check.
   */
  budgets: {
    mobile: { fcp: 2000, lcp: 2100, tbt: 150, cls: 0.02, si: 2000, bytes: 300_000 },
    desktop: { fcp: 600, lcp: 700, tbt: 50, cls: 0.02, si: 800, bytes: 300_000 },
  } satisfies Record<FormFactor, Record<Metric, number>>,
  /**
   * Below this `environment.benchmarkIndex` (Lighthouse's own slow-CPU threshold, which also triggers its
   * "slower CPU" run warning) the simulated timings are not comparable: the run is inconclusive (exit 2),
   * neither pass nor fail. An 8-core development machine scores about 4400-4800.
   */
  minBenchmarkIndex: 1000,
}

const SLOW_CPU_WARNING = 'slower CPU than'

export type Verdict = 'pass' | 'fail' | 'inconclusive'

/** Which performance bar a run is judged by (POLICY.performance). */
export type PerformanceBar = keyof typeof POLICY.performance

/** How one page is measured: its form factor and the performance bar that applies. */
export type Judging = { formFactor: FormFactor; performanceBar: PerformanceBar }

/** One Lighthouse run, as the policy reads it. */
export type RunSummary = {
  run: number
  benchmarkIndex: number
  runWarnings: string[]
  /** Reported, not judged: see `preloadTaskMs` in scripts/lighthouse-runs.ts. */
  preloadTaskMs: number | null
  scores: Record<Category, number | null>
}

/** The runs of one page and form factor, and the median of each metric over them. */
export type Measured = { perRun: RunSummary[]; metrics: Record<Metric, number> }

export const median = (values: number[]): number => {
  const sorted = values.toSorted((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const at = (index: number) => sorted[index] ?? Number.NaN
  return sorted.length % 2 ? at(mid) : (at(mid - 1) + at(mid)) / 2
}

/** Deterministic categories: every run below `everyRun` is a defect. */
const deterministicDefects = (page: Page, perRun: RunSummary[]): string[] => {
  const { categories, everyRun } = POLICY.deterministic
  return page.gated
    .filter((category) => categories.includes(category))
    .flatMap((category) => {
      const low = perRun.filter((run) => run.scores[category] !== everyRun)
      if (!low.length) return []
      const runs = low.map((run) => `run ${run.run} scored ${run.scores[category] ?? 'nothing'}`).join(', ')
      return [`${category}: ${runs} (every run must be ${everyRun})`]
    })
}

/** Where complete performance scores miss the performanceBar: the median, the lowest run, the count of imperfect runs. */
const scoreProblems = (values: number[], performanceBar: PerformanceBar): string[] => {
  const { minMedian, minRun, maxRunsBelow100 } = POLICY.performance[performanceBar]
  const below100 = values.filter((score) => score < 100).length
  return [
    ...(median(values) < minMedian ? [`performance: median ${median(values)} < ${minMedian}`] : []),
    ...(Math.min(...values) < minRun
      ? [`performance: unstable, one run scored ${Math.min(...values)} < ${minRun}`]
      : []),
    ...(below100 > maxRunsBelow100
      ? [`performance: ${below100} runs below 100 (${values.join(', ')}); at most ${maxRunsBelow100} tolerated`]
      : []),
  ]
}

/** The performance score: `defects` when a run has none, `problems` when the scores miss POLICY.performance. */
const performanceFindings = (
  page: Page,
  perRun: RunSummary[],
  performanceBar: PerformanceBar,
): { defects: string[]; problems: string[] } => {
  if (!page.gated.includes('performance')) return { defects: [], problems: [] }
  const scores = perRun.map((run) => run.scores.performance)
  const values = scores.filter((score): score is number => score !== null)
  // A run without a score fails the page on its own (a defect); the performanceBar applies to complete sets only.
  if (values.length !== scores.length) return { defects: ['performance: a run has no score'], problems: [] }
  return { defects: [], problems: scoreProblems(values, performanceBar) }
}

/** Medians over the form factor's budget. A NaN median (the audit is missing) is over budget too. */
const budgetProblems = (formFactor: FormFactor, metrics: Record<Metric, number>): string[] =>
  (Object.entries(POLICY.budgets[formFactor]) as [Metric, number][])
    .filter(([metric, budget]) => !(metrics[metric] <= budget))
    .map(([metric, budget]) => `${metric} ${Number(metrics[metric].toFixed(3))} > budget ${budget}`)

/** Runs on a machine too slow for the simulated timings to mean anything. */
const slowRuns = (perRun: RunSummary[]): RunSummary[] =>
  perRun.filter(
    (run) => run.benchmarkIndex < POLICY.minBenchmarkIndex || run.runWarnings.some((w) => w.includes(SLOW_CPU_WARNING)),
  )

const slowMachineProblem = (slow: RunSummary[]): string =>
  `inconclusive: slow machine (benchmarkIndex ${slow.map((run) => run.benchmarkIndex).join(', ')} in runs ` +
  `${slow.map((run) => run.run).join(', ')}; minimum ${POLICY.minBenchmarkIndex})`

/**
 * The verdict on one page and form factor. Deterministic categories and measurement problems fail outright; the
 * performance score and the metric budgets are only judged on a machine fast enough for the simulation.
 */
export const judge = (
  page: Page,
  { formFactor, performanceBar }: Judging,
  measured: Measured,
): { verdict: Verdict; problems: string[] } => {
  const performance = performanceFindings(page, measured.perRun, performanceBar)
  const defects = [...deterministicDefects(page, measured.perRun), ...performance.defects]
  const overBudget = [...performance.problems, ...budgetProblems(formFactor, measured.metrics)]
  const slow = slowRuns(measured.perRun)
  const problems = [...defects, ...(slow.length ? [slowMachineProblem(slow)] : []), ...overBudget]
  if (defects.length) return { verdict: 'fail', problems }
  if (slow.length) return { verdict: 'inconclusive', problems }
  return { verdict: overBudget.length ? 'fail' : 'pass', problems }
}
