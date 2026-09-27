import { appendFileSync, copyFileSync, mkdirSync, readFileSync, rmSync, statfsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { computeMedianRun } from 'lighthouse/core/lib/median-run.js'
import { Pool } from 'pg'
import { xSync } from 'tinyexec'
import { post, user } from '#/server/db/schema/index.ts'
import { assertChromium, type RunningApp, startApp } from './app-server.ts'
// Lighthouse gate. Boots the built app against a fresh database with seeded posts and a signed-in author,
// puts the reference edge in front of it (deploy/Caddyfile: HTTPS, HTTP/2, compression, as in production),
// runs Lighthouse several times per page and form factor with Playwright's Chromium, and applies POLICY.
// Writes lighthouse-report/summary.{json,md} plus every raw report.
// Usage: pnpm build && pnpm lighthouse [--runs=3] [--page=home] [--form-factor=mobile] [--direct]
//                                      [--edge-protocol=h2|h1|http]
//   --direct: measure the Node server without the edge (to tell app regressions from edge ones).
//   --edge-protocol: h2 (default, production), or HTTP/1.1 over HTTPS (h1) or plain HTTP (http) to compare.
// Exit codes: 0 pass, 1 fail, 2 inconclusive (the machine measured as too slow for the performance score).
// Lighthouse runs one at a time; run nothing else heavy meanwhile, it shifts the simulated timings.
// Env: LIGHTHOUSE_DATABASE_URL overrides the database (default: proofstack_lighthouse_<pid>_test next to
//      DATABASE_URL, dropped afterwards). Logs: lighthouse-report/{app-server,edge}.log. EDGE_RUNTIME: see
//      scripts/edge.ts.
import { dropTestDatabase, testDatabaseUrl } from './test-db.ts'

type Category = 'performance' | 'accessibility' | 'best-practices' | 'seo' | 'agentic-browsing'
type FormFactor = 'mobile' | 'desktop'
type Metric = 'fcp' | 'lcp' | 'tbt' | 'cls' | 'si' | 'bytes'

const GATED: Category[] = ['performance', 'accessibility', 'best-practices', 'seo']
// Lighthouse 13.5 category; reported but not gated while its audits (llms.txt, WebMCP) are experimental.
const REPORTED: Category[] = [...GATED, 'agentic-browsing']

const PAGES: { name: string; path: string; auth?: boolean; gated: Category[] }[] = [
  { name: 'home', path: '/', gated: GATED },
  { name: 'about', path: '/about', gated: GATED },
  // noindex by design (nothing to find there), so SEO does not apply.
  { name: 'login', path: '/login', gated: ['performance', 'accessibility', 'best-practices'] },
  // Private and noindex by design, so SEO does not apply.
  { name: 'dashboard', path: '/dashboard', auth: true, gated: ['performance', 'accessibility', 'best-practices'] },
]

const POLICY = {
  /**
   * Categories whose audits are deterministic (DOM, headers, console): every run must score exactly this.
   * A single lower run is a real defect, not noise.
   */
  deterministic: { categories: ['accessibility', 'best-practices', 'seo'] as Category[], everyRun: 100 },
  /**
   * The performance score comes from simulated throttling over a real trace, and simulated mobile FCP/LCP
   * move in ~150 ms steps, so single runs vary by a point or two. Judged by the median, with at most
   * `maxRunsBelow100` imperfect runs and none below `minRun`.
   */
  performance: { minMedian: 99, maxRunsBelow100: 1, minRun: 95 },
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
   * neither pass nor fail. Seen here: about 4400-4800 on the maintainer's laptop.
   */
  minBenchmarkIndex: 1000,
}

const SLOW_CPU_WARNING = 'slower CPU than'

const METRIC_AUDITS: Record<Metric, string> = {
  fcp: 'first-contentful-paint',
  lcp: 'largest-contentful-paint',
  tbt: 'total-blocking-time',
  cls: 'cumulative-layout-shift',
  si: 'speed-index',
  bytes: 'total-byte-weight',
}

const option = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]
const runs = Number(option('runs') ?? 3)
const formFactors = (option('form-factor') ? [option('form-factor')] : ['mobile', 'desktop']) as FormFactor[]
const pages = PAGES.filter((p) => !option('page') || p.name === option('page'))
const direct = process.argv.includes('--direct')
/**
 * How Chrome reaches the edge. h2 (default) is production: HTTPS, where Chrome negotiates HTTP/2 and
 * shares one connection for the page. h1 forces HTTP/1.1 over the same HTTPS edge, http is plain HTTP/1.1;
 * both only to compare.
 */
const PROTOCOLS = ['h2', 'h1', 'http'] as const
const protocol = (option('edge-protocol') ?? 'h2') as (typeof PROTOCOLS)[number]
if (!PROTOCOLS.includes(protocol)) throw new Error(`--edge-protocol must be one of ${PROTOCOLS.join(', ')}`)
const tls = !direct && protocol !== 'http'
const OUT = 'lighthouse-report'

const median = (values: number[]) => {
  const sorted = values.toSorted((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const at = (index: number) => sorted[index] ?? Number.NaN
  return sorted.length % 2 ? at(mid) : (at(mid - 1) + at(mid)) / 2
}

type Lhr = {
  finalDisplayedUrl: string
  runtimeError?: { message: string }
  runWarnings: string[]
  environment: { benchmarkIndex: number }
  categories: Record<string, { score: number | null; auditRefs: { id: string; weight: number }[] }>
  audits: Record<string, { score: number | null; numericValue?: number; scoreDisplayMode: string; title: string }>
}

const POSTS = [
  'Shipped the first version of the contract checks. The SDK now fails CI when it drifts from the served API.',
  'Short posts keep the example honest: rendering, the database, sessions and validation all in one flow.',
  'Measured the public page on a throttled mobile profile. Every category needs to stay at 100.',
  'Reminder to self: the authenticated route is measured too, minus SEO because it is private.',
]

// Posts go straight to the database so public pages can be measured even when sign-in is broken.
const seedPosts = async (databaseUrl: string, email: string) => {
  const pool = new Pool({ connectionString: databaseUrl })
  try {
    const db = drizzle({ client: pool })
    const [author] = await db.select({ id: user.id }).from(user).where(eq(user.email, email))
    if (!author) throw new Error(`seed author ${email} not found`)
    await db
      .insert(post)
      .values(POSTS.map((body, i) => ({ authorId: author.id, body, createdAt: new Date(Date.UTC(2026, 0, 1 + i)) })))
  } finally {
    await pool.end()
  }
}

const signIn = async (appUrl: string, credentials: { email: string; password: string }) => {
  const res = await fetch(`${appUrl}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: appUrl },
    body: JSON.stringify(credentials),
  })
  if (!res.ok) throw new Error(`sign-in failed: ${res.status} ${await res.text()}`)
  return res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')
}

// Chrome keeps shared memory in /dev/shm, which is 64 MB in a default Docker container: renderers crash or
// stall there and the timings suffer. Below 1 GiB Chrome is told to use /tmp instead (slower, but stable).
const shmBytes = (() => {
  try {
    const stats = statfsSync('/dev/shm')
    return stats.blocks * stats.bsize
  } catch {
    return 0
  }
})()
const smallShm = shmBytes < 1024 ** 3
const chromeFlags = ['--headless=new', '--no-sandbox', ...(smallShm ? ['--disable-dev-shm-usage'] : [])]

const lighthouse = (url: string, formFactor: FormFactor, outputBase: string, cookie?: string): Lhr => {
  const args = [
    'exec',
    'lighthouse',
    url,
    '--output=json',
    '--output=html',
    `--output-path=${outputBase}`,
    `--only-categories=${REPORTED.join(',')}`,
    `--chrome-flags=${chromeFlags.join(' ')}`,
    '--quiet',
    ...(formFactor === 'desktop' ? ['--preset=desktop'] : []),
    ...(cookie ? [`--extra-headers=${JSON.stringify({ cookie })}`] : []),
  ]
  const result = xSync('pnpm', args, {
    timeout: 180_000,
    nodeOptions: { stdio: 'inherit', env: { CHROME_PATH: chromePath } },
  })
  if (result.exitCode !== 0)
    throw new Error(`lighthouse failed for ${url} (${formFactor}): ${result.exitCode ?? result.signalCode}`)
  return JSON.parse(readFileSync(`${outputBase}.report.json`, 'utf8')) as Lhr
}

const score = (lhr: Lhr, category: Category) => {
  const value = lhr.categories[category]?.score
  return value == null ? null : Math.round(value * 100)
}

const failingAudits = (lhr: Lhr, categories: Category[]) => [
  ...new Set(
    categories.flatMap((category) =>
      (lhr.categories[category]?.auditRefs ?? [])
        .filter((ref) => ref.weight > 0)
        .flatMap((ref) => lhr.audits[ref.id] ?? [])
        .filter(
          (audit) =>
            audit.scoreDisplayMode !== 'notApplicable' &&
            audit.scoreDisplayMode !== 'informative' &&
            audit.score !== null &&
            audit.score < 1,
        )
        .map((audit) => `${category}: ${audit.title} (${audit.score})`),
    ),
  ),
]

type Verdict = 'pass' | 'fail' | 'inconclusive'

const chromePath = await assertChromium()
if (smallShm)
  console.warn(
    `/dev/shm has ${Math.round(shmBytes / 1024 ** 2)} MiB (< 1 GiB): Chrome runs with --disable-dev-shm-usage. ` +
      'In Docker, pass --shm-size=2g.',
  )
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
const databaseUrl = testDatabaseUrl('lighthouse', process.env.LIGHTHOUSE_DATABASE_URL)
const results = []
let app: RunningApp | undefined
// startApp creates the database: it is dropped in the finally below even when a server or create-user fails.
try {
  app = await startApp({
    databaseUrl,
    logFile: join(OUT, 'app-server.log'),
    ...(direct ? {} : { edge: { logFile: join(OUT, 'edge.log'), tls } }),
  })
  // Chrome trusts exactly the key of the edge's local certificate (not every certificate error), so the page
  // is a secure https origin as in production, and best-practices audits see what users would see.
  if (app.edgeCertificateSpki) chromeFlags.push(`--ignore-certificate-errors-spki-list=${app.edgeCertificateSpki}`)
  if (protocol === 'h1') chromeFlags.push('--disable-http2', '--disable-quic')
  console.log(
    `measuring ${app.url}${direct ? ' (Node server, no edge)' : ` (edge in front of ${app.directUrl}, ${protocol})`}`,
  )
  await seedPosts(databaseUrl, app.user.email)
  const cookie = pages.some((p) => p.auth)
    ? await signIn(app.url, { email: app.user.email, password: app.user.password })
    : undefined
  // Warm the server so the first measured run does not pay for lazy initialization.
  for (const page of pages) await fetch(app.url + page.path, { headers: page.auth && cookie ? { cookie } : {} })

  for (const page of pages) {
    for (const formFactor of formFactors) {
      const lhrs: Lhr[] = []
      for (let i = 1; i <= runs; i++) {
        const lhr = lighthouse(
          app.url + page.path,
          formFactor,
          join(OUT, `${page.name}-${formFactor}-${i}`),
          page.auth ? cookie : undefined,
        )
        if (lhr.runtimeError) throw new Error(`${page.name} ${formFactor}: ${lhr.runtimeError.message}`)
        if (new URL(lhr.finalDisplayedUrl).pathname !== page.path)
          throw new Error(`${page.name}: landed on ${lhr.finalDisplayedUrl}`)
        lhrs.push(lhr)
      }
      const scores = Object.fromEntries(
        REPORTED.map((c) => {
          const values = lhrs.map((l) => score(l, c)).filter((v): v is number => v !== null)
          return [
            c,
            values.length ? { median: median(values), min: Math.min(...values), max: Math.max(...values) } : null,
          ]
        }),
      ) as Record<Category, { median: number; min: number; max: number } | null>
      const metrics = Object.fromEntries(
        Object.entries(METRIC_AUDITS).map(([metric, audit]) => [
          metric,
          median(lhrs.map((l) => l.audits[audit]?.numericValue ?? Number.NaN)),
        ]),
      ) as Record<Metric, number>
      const perRun = lhrs.map((lhr, i) => ({
        run: i + 1,
        benchmarkIndex: Math.round(lhr.environment.benchmarkIndex),
        runWarnings: lhr.runWarnings,
        scores: Object.fromEntries(REPORTED.map((c) => [c, score(lhr, c)])),
      }))

      // Deterministic categories and measurement problems fail outright; the performance score and the
      // metric budgets are only judged on a machine fast enough for the simulation to mean something.
      const defects: string[] = []
      for (const c of page.gated.filter((gated) => POLICY.deterministic.categories.includes(gated))) {
        const low = perRun.filter((r) => r.scores[c] !== POLICY.deterministic.everyRun)
        if (low.length)
          defects.push(
            `${c}: ${low.map((r) => `run ${r.run} scored ${r.scores[c] ?? 'nothing'}`).join(', ')} (every run must be ${POLICY.deterministic.everyRun})`,
          )
      }
      const performance: string[] = []
      const perf = lhrs.map((l) => score(l, 'performance'))
      if (page.gated.includes('performance')) {
        const values = perf.filter((v): v is number => v !== null)
        const below100 = values.filter((v) => v < 100).length
        if (values.length !== perf.length) defects.push('performance: a run has no score')
        else if (median(values) < POLICY.performance.minMedian)
          performance.push(`performance: median ${median(values)} < ${POLICY.performance.minMedian}`)
        if (Math.min(...values) < POLICY.performance.minRun)
          performance.push(
            `performance: unstable, one run scored ${Math.min(...values)} < ${POLICY.performance.minRun}`,
          )
        if (below100 > POLICY.performance.maxRunsBelow100)
          performance.push(
            `performance: ${below100} runs below 100 (${values.join(', ')}); at most ${POLICY.performance.maxRunsBelow100} tolerated`,
          )
      }
      for (const [metric, budget] of Object.entries(POLICY.budgets[formFactor]) as [Metric, number][]) {
        if (!(metrics[metric] <= budget))
          performance.push(`${metric} ${Number(metrics[metric].toFixed(3))} > budget ${budget}`)
      }
      const slow = perRun.filter(
        (r) => r.benchmarkIndex < POLICY.minBenchmarkIndex || r.runWarnings.some((w) => w.includes(SLOW_CPU_WARNING)),
      )
      const verdict: Verdict = defects.length
        ? 'fail'
        : slow.length
          ? 'inconclusive'
          : performance.length
            ? 'fail'
            : 'pass'
      const problems = [
        ...defects,
        ...(slow.length
          ? [
              `inconclusive: slow machine (benchmarkIndex ${slow.map((r) => r.benchmarkIndex).join(', ')} in runs ${slow.map((r) => r.run).join(', ')}; minimum ${POLICY.minBenchmarkIndex})`,
            ]
          : []),
        ...performance,
      ]

      // Lighthouse's own median-run selection (closest to the median FCP and TTI) picks the report to read.
      const medianLhr = computeMedianRun(lhrs as never) as unknown as Lhr
      const medianRun = lhrs.indexOf(medianLhr) + 1
      copyFileSync(
        join(OUT, `${page.name}-${formFactor}-${medianRun}.report.html`),
        join(OUT, `${page.name}-${formFactor}-median.report.html`),
      )
      const result = {
        page: page.name,
        path: page.path,
        formFactor,
        runs,
        verdict,
        scores,
        metrics,
        problems,
        medianRun,
        perRun,
        failingAudits: failingAudits(medianLhr, page.gated),
      }
      results.push(result)
      console.log(
        `${verdict.toUpperCase().padEnd(12)} ${page.name} ${formFactor} ${REPORTED.map((c) => `${c}=${scores[c]?.median ?? '-'}`).join(' ')} perf runs ${perf.join(',')} benchmarkIndex ${perRun.map((r) => r.benchmarkIndex).join(',')}`,
      )
    }
  }
} finally {
  await app?.stop()
  if (!process.env.LIGHTHOUSE_DATABASE_URL) await dropTestDatabase(databaseUrl)
}

const fmtScore = (s: { median: number; min: number; max: number } | null, gated: boolean) =>
  !s ? '–' : `${s.median}${s.min !== s.max ? ` (${s.min}–${s.max})` : ''}${gated ? '' : '*'}`
const indexes = results.flatMap((r) => r.perRun.map((p) => p.benchmarkIndex))
const table = [
  `Lighthouse ${(JSON.parse(readFileSync('node_modules/lighthouse/package.json', 'utf8')) as { version: string }).version}, median of ${runs} runs, ` +
    `${direct ? 'Node server without the edge' : `through the Caddy edge (${protocol})`}. benchmarkIndex ${Math.min(...indexes)}–${Math.max(...indexes)}. ` +
    '* = reported, not gated. Diagnose with `<page>-<form factor>-median.report.html` (Lighthouse median run).',
  '',
  '| Page | Form factor | Perf | A11y | Best pr. | SEO | Agentic | FCP | LCP | TBT | CLS | Bytes | Result |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ...results.map((r) => {
    const gated = PAGES.find((p) => p.name === r.page)?.gated ?? []
    const cells = REPORTED.map((c) => fmtScore(r.scores[c], gated.includes(c)))
    const m = r.metrics
    return `| ${r.path} | ${r.formFactor} | ${cells.join(' | ')} | ${Math.round(m.fcp)} ms | ${Math.round(m.lcp)} ms | ${Math.round(m.tbt)} ms | ${m.cls.toFixed(3)} | ${Math.round(m.bytes / 1024)} KiB | ${r.verdict}${r.problems.length ? `: ${r.problems.join('; ')}` : ''} |`
  }),
].join('\n')

writeFileSync(
  join(OUT, 'summary.json'),
  `${JSON.stringify({ policy: POLICY, edge: direct ? false : protocol, shmBytes, results }, null, 2)}\n`,
)
writeFileSync(join(OUT, 'summary.md'), `${table}\n`)
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Lighthouse\n\n${table}\n`)
console.log(`\n${table}\n`)
for (const r of results)
  if (r.failingAudits.length)
    console.log(
      `${r.page} ${r.formFactor} audits below 1 (median run ${r.medianRun}):\n  ${r.failingAudits.join('\n  ')}`,
    )
const verdicts = new Set(results.map((r) => r.verdict))
if (verdicts.has('fail')) process.exitCode = 1
else if (verdicts.has('inconclusive')) {
  console.error('\nInconclusive: this machine measured too slow for the performance score to mean anything (exit 2).')
  process.exitCode = 2
} else process.exitCode = 0
