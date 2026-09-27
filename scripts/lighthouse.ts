// Lighthouse gate. Boots the built app against a fresh database with seeded data and a signed-in author,
// puts the reference edge in front of it (deploy/Caddyfile: HTTPS, HTTP/2, compression, as in production),
// runs Lighthouse several times per page and form factor with Playwright's Chromium, and applies POLICY
// (scripts/lighthouse-policy.ts, with PAGES). Writes lighthouse-report/summary.{json,md} plus every raw report
// (scripts/lighthouse-report.ts).
// Usage: pnpm build && pnpm lighthouse [--runs=3] [--page=home] [--form-factor=mobile] [--direct]
//                                      [--edge-protocol=h2|h1|http] [--bar=target|ci]
//   --bar: the performance bar (POLICY.performance in scripts/lighthouse-policy.ts); `ci` is what CI applies.
//   --direct: measure the Node server without the edge (to tell app regressions from edge ones).
//   --edge-protocol: h2 (default, production), or HTTP/1.1 over HTTPS (h1) or plain HTTP (http) to compare.
// Exit codes: 0 pass, 1 fail, 2 inconclusive (the machine measured as too slow for the performance score).
// Lighthouse runs one at a time; run nothing else heavy meanwhile, it shifts the simulated timings.
// Env: LIGHTHOUSE_DATABASE_URL overrides the database (default: app_lighthouse_<pid>_test next to
//      DATABASE_URL, dropped afterwards). Logs: lighthouse-report/{app-server,edge}.log. EDGE_RUNTIME: see
//      scripts/edge.ts.
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { post, user } from '#/server/db/schema/index.ts'
import { type RunningApp, startApp } from './app-server.ts'
import { type FormFactor, judge, type Page, PAGES, type PerformanceBar } from './lighthouse-policy.ts'
import { exitCodeOf, type PageOutcome, progressLine, writeReport } from './lighthouse-report.ts'
import {
  type Chrome,
  chromeFlags,
  failingAudits,
  findChromium,
  keepMedianReport,
  type Lhr,
  runLighthouse,
  SHM_BYTES,
  SMALL_SHM,
  summarizeRuns,
} from './lighthouse-runs.ts'
import { dropTestDatabase, testDatabaseUrl } from './test-db.ts'

const OUT = 'lighthouse-report'

const option = (name: string) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.split('=')[1]

/** `--<name>=<value>` when `value` is one of `allowed`, else `fallback`; anything else is a usage error. */
const oneOf = <T extends string>(name: string, allowed: readonly T[], fallback: T[]): T[] => {
  const value = option(name)
  if (value === undefined) return fallback
  if (!allowed.includes(value as T)) throw new Error(`--${name} must be one of ${allowed.join(', ')} (got "${value}")`)
  return [value as T]
}

const runs = Number(option('runs') ?? 3)
if (!Number.isInteger(runs) || runs < 1) throw new Error(`--runs must be a positive integer (got "${option('runs')}")`)
const formFactors = oneOf<FormFactor>('form-factor', ['mobile', 'desktop'], ['mobile', 'desktop'])
const pageNames = oneOf(
  'page',
  PAGES.map((page) => page.name),
  PAGES.map((page) => page.name),
)
const pages = PAGES.filter((page) => pageNames.includes(page.name))
const direct = process.argv.includes('--direct')
const [performanceBar = 'target'] = oneOf<PerformanceBar>('bar', ['target', 'ci'], ['target'])
/**
 * How Chrome reaches the edge. h2 (default) is production: HTTPS, where Chrome negotiates HTTP/2 and
 * shares one connection for the page. h1 forces HTTP/1.1 over the same HTTPS edge, http is plain HTTP/1.1;
 * both only to compare.
 */
const [protocol = 'h2'] = oneOf('edge-protocol', ['h2', 'h1', 'http'] as const, ['h2'])
const tls = !direct && protocol !== 'http'

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
    if (!author) throw new Error(`seed author ${email} not found in the user table of ${new URL(databaseUrl).pathname}`)
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
  if (!res.ok)
    throw new Error(`sign-in as ${credentials.email} failed: ${res.status}, expected 200. ${await res.text()}`)
  return res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')
}

/** Where the runs point: the app's public URL, the author's session cookie (for `auth` pages) and Chrome. */
type Target = { url: string; cookie: string | undefined; chrome: Chrome }

/** `runs` Lighthouse runs of one page and form factor; each must have loaded the page itself. */
const measureRuns = (target: Target, page: Page, formFactor: FormFactor): Lhr[] =>
  Array.from({ length: runs }, (_, index) => {
    const lhr = runLighthouse({
      url: target.url + page.path,
      formFactor,
      outputBase: join(OUT, `${page.name}-${formFactor}-${index + 1}`),
      cookie: page.auth ? target.cookie : undefined,
      chrome: target.chrome,
    })
    if (lhr.runtimeError) throw new Error(`${page.name} ${formFactor}: ${lhr.runtimeError.message}`)
    if (new URL(lhr.finalDisplayedUrl).pathname !== page.path)
      throw new Error(`${page.name}: landed on ${lhr.finalDisplayedUrl}, expected the path ${page.path}`)
    return lhr
  })

const measurePage = (target: Target, page: Page, formFactor: FormFactor): PageOutcome => {
  const lhrs = measureRuns(target, page, formFactor)
  const { scores, metrics, perRun } = summarizeRuns(lhrs)
  const { verdict, problems } = judge(page, { formFactor, performanceBar }, { metrics, perRun })
  const { medianLhr, medianRun } = keepMedianReport(lhrs, join(OUT, `${page.name}-${formFactor}`))
  return {
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
}

/** Seeds the posts, signs the author in if a page needs it, warms the server, then measures every page. */
const measureApp = async (app: RunningApp, chromePath: string): Promise<PageOutcome[]> => {
  const flags = chromeFlags({ edgeCertificateSpki: app.edgeCertificateSpki, http1: protocol === 'h1' })
  const through = direct ? ' (Node server, no edge)' : ` (edge in front of ${app.directUrl}, ${protocol})`
  console.log(`measuring ${app.url}${through}`)
  await seedPosts(app.databaseUrl, app.user.email)
  const cookie = pages.some((page) => page.auth)
    ? await signIn(app.url, { email: app.user.email, password: app.user.password })
    : undefined
  // Warm the server so the first measured run does not pay for lazy initialization.
  for (const page of pages) await fetch(app.url + page.path, { headers: page.auth && cookie ? { cookie } : {} })
  const target = { url: app.url, cookie, chrome: { path: chromePath, flags } }
  return pages.flatMap((page) =>
    formFactors.map((formFactor) => {
      const outcome = measurePage(target, page, formFactor)
      console.log(progressLine(outcome))
      return outcome
    }),
  )
}

const chromePath = await findChromium()
if (SMALL_SHM)
  console.warn(
    `/dev/shm has ${Math.round(SHM_BYTES / 1024 ** 2)} MiB (< 1 GiB): Chrome runs with --disable-dev-shm-usage. ` +
      'In Docker, pass --shm-size=2g.',
  )
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
const databaseUrl = testDatabaseUrl('lighthouse', process.env.LIGHTHOUSE_DATABASE_URL)
let outcomes: PageOutcome[] = []
let app: RunningApp | undefined
// startApp creates the database: it is dropped in the finally below even when a server or create-user fails.
try {
  app = await startApp({
    databaseUrl,
    logFile: join(OUT, 'app-server.log'),
    ...(direct ? {} : { edge: { logFile: join(OUT, 'edge.log'), tls } }),
  })
  outcomes = await measureApp(app, chromePath)
} finally {
  await app?.stop()
  if (!process.env.LIGHTHOUSE_DATABASE_URL) await dropTestDatabase(databaseUrl)
}
writeReport(outcomes, { runs, edge: direct ? false : protocol, shmBytes: SHM_BYTES, outputDir: OUT })
process.exitCode = exitCodeOf(outcomes)
