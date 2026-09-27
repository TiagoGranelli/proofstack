// Lighthouse gate. Boots the built app against a fresh database with seeded posts and a signed-in author,
// runs Lighthouse several times per page and form factor with Playwright's Chromium, and applies POLICY
// to the medians. Writes lighthouse-report/summary.{json,md} plus every raw report.
// Usage: pnpm build && pnpm lighthouse [--runs=3] [--page=home] [--form-factor=mobile]
// Env: LIGHTHOUSE_DATABASE_URL overrides the database (default: proofstack_lighthouse_<pid>_test next to
//      DATABASE_URL, dropped afterwards). The server log is lighthouse-report/app-server.log.
import { spawnSync } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { post, user } from '#/server/db/schema/index.ts'
import { assertChromium, startApp } from './app-server.ts'
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
  /** Every gated category median must reach this score. */
  minMedianScore: 99,
  /** A median of 99 is tolerated as measurement noise in at most this many categories per page and form factor. */
  maxCategoriesAt99: 1,
  /** A single run below this score fails even if the median passes: the result is too unstable to trust. */
  minRunScore: 95,
  /**
   * Hard budgets on the medians (ms, unitless CLS, bytes): a backstop ~30-50% above the measured values
   * (simulated mobile FCP/LCP move in ~150 ms steps). The score gate above is the tighter check.
   */
  budgets: {
    mobile: { fcp: 2000, lcp: 2100, tbt: 150, cls: 0.02, si: 2000, bytes: 300_000 },
    desktop: { fcp: 600, lcp: 700, tbt: 50, cls: 0.02, si: 800, bytes: 300_000 },
  } satisfies Record<FormFactor, Record<Metric, number>>,
}

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
const OUT = 'lighthouse-report'

const median = (values: number[]) => {
  const sorted = values.toSorted((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

type Lhr = {
  finalDisplayedUrl: string
  runtimeError?: { message: string }
  runWarnings: string[]
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

const lighthouse = (url: string, formFactor: FormFactor, outputBase: string, cookie?: string): Lhr => {
  const args = [
    'exec',
    'lighthouse',
    url,
    '--output=json',
    '--output=html',
    `--output-path=${outputBase}`,
    `--only-categories=${REPORTED.join(',')}`,
    '--chrome-flags=--headless=new --no-sandbox',
    '--quiet',
    ...(formFactor === 'desktop' ? ['--preset=desktop'] : []),
    ...(cookie ? [`--extra-headers=${JSON.stringify({ cookie })}`] : []),
  ]
  const result = spawnSync('pnpm', args, {
    stdio: 'inherit',
    env: { ...process.env, CHROME_PATH: chromePath },
    timeout: 180_000,
  })
  if (result.status !== 0)
    throw new Error(`lighthouse failed for ${url} (${formFactor}): ${result.status ?? result.signal}`)
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
        .map((ref) => lhr.audits[ref.id]!)
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

const chromePath = await assertChromium()
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
const databaseUrl = testDatabaseUrl('lighthouse', process.env.LIGHTHOUSE_DATABASE_URL)
const app = await startApp({ databaseUrl, logFile: join(OUT, 'app-server.log') })
const results = []
try {
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

      const problems: string[] = []
      const at99 = page.gated.filter((c) => scores[c]?.median === 99)
      for (const c of page.gated) {
        const s = scores[c]
        if (!s) problems.push(`${c}: no score`)
        else if (s.median < POLICY.minMedianScore) problems.push(`${c}: median ${s.median} < ${POLICY.minMedianScore}`)
        else if (s.min < POLICY.minRunScore)
          problems.push(`${c}: unstable, one run scored ${s.min} < ${POLICY.minRunScore}`)
      }
      if (at99.length > POLICY.maxCategoriesAt99)
        problems.push(`${at99.join(', ')} at 99: only ${POLICY.maxCategoriesAt99} tolerated`)
      for (const [metric, budget] of Object.entries(POLICY.budgets[formFactor]) as [Metric, number][]) {
        if (!(metrics[metric] <= budget))
          problems.push(`${metric} ${Number(metrics[metric].toFixed(3))} > budget ${budget}`)
      }
      // The run closest to the median performance score, for diagnosis.
      const medianRun = lhrs.toSorted((a, b) => (score(a, 'performance') ?? 0) - (score(b, 'performance') ?? 0))[
        Math.floor(lhrs.length / 2)
      ]!
      const result = {
        page: page.name,
        path: page.path,
        formFactor,
        runs,
        scores,
        metrics,
        problems,
        failingAudits: failingAudits(medianRun, page.gated),
      }
      results.push(result)
      console.log(
        `${problems.length ? 'FAIL' : 'ok  '} ${page.name} ${formFactor} ${REPORTED.map((c) => `${c}=${scores[c]?.median ?? '-'}`).join(' ')}`,
      )
    }
  }
} finally {
  await app.stop()
  if (!process.env.LIGHTHOUSE_DATABASE_URL) await dropTestDatabase(databaseUrl)
}

const fmtScore = (s: { median: number; min: number; max: number } | null, gated: boolean) =>
  !s ? '–' : `${s.median}${s.min !== s.max ? ` (${s.min}–${s.max})` : ''}${gated ? '' : '*'}`
const table = [
  `Lighthouse ${JSON.parse(readFileSync('node_modules/lighthouse/package.json', 'utf8')).version}, median of ${runs} runs. * = reported, not gated.`,
  '',
  '| Page | Form factor | Perf | A11y | Best pr. | SEO | Agentic | FCP | LCP | TBT | CLS | Bytes | Result |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ...results.map((r) => {
    const gated = PAGES.find((p) => p.name === r.page)!.gated
    const cells = REPORTED.map((c) => fmtScore(r.scores[c], gated.includes(c)))
    const m = r.metrics
    return `| ${r.path} | ${r.formFactor} | ${cells.join(' | ')} | ${Math.round(m.fcp)} ms | ${Math.round(m.lcp)} ms | ${Math.round(m.tbt)} ms | ${m.cls.toFixed(3)} | ${Math.round(m.bytes / 1024)} KiB | ${r.problems.length ? `FAIL: ${r.problems.join('; ')}` : 'pass'} |`
  }),
].join('\n')

writeFileSync(join(OUT, 'summary.json'), `${JSON.stringify({ policy: POLICY, results }, null, 2)}\n`)
writeFileSync(join(OUT, 'summary.md'), `${table}\n`)
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Lighthouse\n\n${table}\n`)
console.log(`\n${table}\n`)
for (const r of results)
  if (r.failingAudits.length)
    console.log(`${r.page} ${r.formFactor} audits below 1:\n  ${r.failingAudits.join('\n  ')}`)
process.exitCode = results.some((r) => r.problems.length) ? 1 : 0
