// Lighthouse gate. Serves the production build (dist/) with `vite preview` over HTTPS and HTTP/2, as a static host
// would serve it (ADR 0011), runs Lighthouse several times per page and form factor with Playwright's Chromium, and
// applies POLICY (scripts/lighthouse-policy.ts, with PAGES). Writes lighthouse-report/summary.{json,md} plus every
// raw report (scripts/lighthouse-report.ts).
// Usage: pnpm build && pnpm lighthouse [--runs=3] [--page=home] [--form-factor=mobile] [--protocol=h2|h1|http]
//                                      [--bar=target|ci]
//   --bar: the performance bar (POLICY.performance in scripts/lighthouse-policy.ts); `ci` is what CI applies.
//   --protocol: h2 (default, what a static host serves), or HTTP/1.1 over HTTPS (h1) or plain HTTP (http) to compare.
// Exit codes: 0 pass, 1 fail, 2 inconclusive (the machine measured as too slow for the performance score).
// Lighthouse runs one at a time; run nothing else heavy meanwhile, it shifts the simulated timings.
import { createHash, X509Certificate } from 'node:crypto'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { preview, type PreviewServer } from 'vite'
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
const [performanceBar = 'target'] = oneOf<PerformanceBar>('bar', ['target', 'ci'], ['target'])
/**
 * How Chrome reaches the build. h2 (default): HTTPS, where Chrome negotiates HTTP/2 and shares one connection for
 * the page, as on any static host. h1 forces HTTP/1.1 over the same HTTPS server, http is plain HTTP/1.1; both
 * only to compare.
 */
const [protocol = 'h2'] = oneOf('protocol', ['h2', 'h1', 'http'] as const, ['h2'])
const tls = protocol !== 'http'

/**
 * Base64 SHA-256 of the served certificate's public key. Chrome trusts exactly that key
 * (`--ignore-certificate-errors-spki-list`), not every certificate error, so the page is a secure origin and the
 * best-practices audits see what users would see.
 */
const certificateSpki = (server: PreviewServer): string | undefined => {
  if (!tls) return undefined
  const cert = server.config.preview.https?.cert
  if (typeof cert !== 'string' && !Buffer.isBuffer(cert))
    throw new Error('vite preview has no PEM certificate: @vitejs/plugin-basic-ssl should have set preview.https.cert')
  const spki = new X509Certificate(cert).publicKey.export({ type: 'spki', format: 'der' })
  return createHash('sha256').update(spki).digest('base64')
}

/** Where the runs point: the preview server's URL and the Chrome that loads it. */
type Target = { url: string; chrome: Chrome }

/** `runs` Lighthouse runs of one page and form factor, one after another; each must have loaded the page itself. */
const measureRuns = async ({ url, chrome }: Target, page: Page, formFactor: FormFactor): Promise<Lhr[]> => {
  const lhrs: Lhr[] = []
  for (let index = 0; index < runs; index++) {
    const lhr = await runLighthouse({
      url: url + page.path,
      formFactor,
      outputBase: join(OUT, `${page.name}-${formFactor}-${index + 1}`),
      chrome,
    })
    if (lhr.runtimeError) throw new Error(`${page.name} ${formFactor}: ${lhr.runtimeError.message}`)
    if (new URL(lhr.finalDisplayedUrl).pathname !== page.path)
      throw new Error(`${page.name}: landed on ${lhr.finalDisplayedUrl}, expected the path ${page.path}`)
    lhrs.push(lhr)
  }
  return lhrs
}

const measurePage = async (target: Target, page: Page, formFactor: FormFactor): Promise<PageOutcome> => {
  const lhrs = await measureRuns(target, page, formFactor)
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

/** Measures every page on the running preview server, one at a time. */
const measureAll = async (server: PreviewServer, chromePath: string): Promise<PageOutcome[]> => {
  const url = server.resolvedUrls?.local[0]?.replace(/\/$/, '')
  if (!url) throw new Error('vite preview is not listening: it resolved no local URL')
  const flags = chromeFlags({ certificateSpki: certificateSpki(server), http1: protocol === 'h1' })
  const target = { url, chrome: { path: chromePath, flags } }
  console.log(`measuring ${url} (vite preview, ${protocol})`)
  const outcomes: PageOutcome[] = []
  for (const page of pages)
    for (const formFactor of formFactors) {
      const outcome = await measurePage(target, page, formFactor)
      console.log(progressLine(outcome))
      outcomes.push(outcome)
    }
  return outcomes
}

if (!existsSync('dist/index.html')) throw new Error('dist/index.html is missing: run `pnpm build` first')
const chromePath = await findChromium()
if (SMALL_SHM)
  console.warn(
    `/dev/shm has ${Math.round(SHM_BYTES / 1024 ** 2)} MiB (< 1 GiB): Chrome runs with --disable-dev-shm-usage. ` +
      'In Docker, pass --shm-size=2g.',
  )
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
// A port of its own, next to the E2E server's 4173; the next free one if it is taken.
const server = await preview({
  plugins: tls ? [basicSsl()] : [],
  preview: { port: 4174, strictPort: false, host: 'localhost' },
  logLevel: 'warn',
})
let outcomes: PageOutcome[] = []
try {
  outcomes = await measureAll(server, chromePath)
} finally {
  await server.close()
}
writeReport(outcomes, { runs, protocol, shmBytes: SHM_BYTES, outputDir: OUT })
process.exitCode = exitCodeOf(outcomes)
