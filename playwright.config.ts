import { availableParallelism } from 'node:os'
import { defineConfig, devices } from '@playwright/test'

// tests/e2e/global-setup.ts starts the app and sets APP_URL before the workers load this file again.
const baseURL = process.env.APP_URL ?? 'http://localhost:3000'

// Every flow runs on every project. WebKit (and with it iPhone 15) needs Ubuntu's libraries and does not run
// on every Linux host, so outside CI the default is the two desktop engines that run anywhere; `pnpm ci:local`
// and CI run all five. Choose with PW_PROJECTS: a comma-separated list of names, or `all`. Each starts after
// the `setup` projects, which write the data the specs share.
// tests/e2e/seed.setup.ts: more posts than fit on a page, for the pagination spec.
const setup = [{ name: 'seed', testMatch: /seed\.setup\.ts$/ }]
const dependencies = setup.map((project) => project.name)
const PROJECTS = [
  { name: 'chromium', dependencies, use: { ...devices['Desktop Chrome'] } },
  {
    name: 'firefox',
    dependencies,
    use: {
      ...devices['Desktop Firefox'],
      // Playwright 1.63's Firefox driver sometimes never resolves the first `goto` of a page to a document with
      // `Cross-Origin-Opener-Policy: same-origin`, which every page of the app sends: the browsing-context swap
      // stays in the same process and Juggler answers the new document's commit from a stale cache
      // (microsoft/playwright#42731, fixed after 1.63). With this, Firefox skips COOP's browsing-context swap;
      // tests/integration/security.test.ts checks the header. Remove on upgrading Playwright past 1.63.
      launchOptions: { firefoxUserPrefs: { 'browser.tabs.remote.useCrossOriginOpenerPolicy': false } },
    },
  },
  // Known upstream flake in both WebKit projects: Playwright 1.63's WebKit on Linux sometimes never resolves the
  // first `goto` of a page to a document with COOP same-origin. The process swap COOP causes is cancelled ("Load
  // request cancelled") and Playwright drops the abort, so `goto` waits for a commit that never comes
  // (microsoft/playwright#42957, open; about 1 in 500 such navigations under CPU contention, none without COOP).
  // No launch option turns COOP off here as the Firefox pref does: MiniBrowser's --features never reaches the
  // pages Playwright creates.
  { name: 'webkit', dependencies, use: { ...devices['Desktop Safari'] } },
  { name: 'Pixel 7', dependencies, use: { ...devices['Pixel 7'] } },
  { name: 'iPhone 15', dependencies, use: { ...devices['iPhone 15'] } },
]
const LOCAL_DEFAULT = ['chromium', 'firefox']

const requested = process.env.PW_PROJECTS?.trim() || (process.env.CI ? 'all' : LOCAL_DEFAULT.join(','))
const names = requested === 'all' ? PROJECTS.map((p) => p.name) : requested.split(',').map((n) => n.trim())
const unknown = names.filter((name) => !PROJECTS.some((p) => p.name === name))
if (unknown.length)
  throw new Error(
    `PW_PROJECTS: unknown project(s) ${unknown.join(', ')}; expected all or ${PROJECTS.map((p) => p.name).join(', ')}`,
  )

// Locally a passing run is a count and a failing one its failures, each with its error, code and trace path. `line`
// redraws one line at a terminal; into a pipe or an agent's log it would print every test, so there `dot` prints a
// character per test. CI keeps GitHub's annotations and the HTML report.
const LOCAL_REPORTER = process.stdout.isTTY ? 'line' : 'dot'

export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  // Playwright empties its output directory on start; the app servers' logs (test-results/app-server-e2e*.log) live
  // next to it.
  outputDir: 'test-results/playwright',
  fullyParallel: false,
  // Half the CPUs, as Playwright's default, but the CPUs this process may use: Playwright counts os.cpus(), every
  // core of the host, so in a container limited to 4 (`pnpm ci:local`) it started 16 workers and tests timed out.
  workers: Math.max(1, Math.floor(availableParallelism() / 2)),
  forbidOnly: !!process.env.CI,
  // A retry keeps one bad run from hiding the report of the others, but a test that only passes on retry is a
  // failure in CI: flakiness is fixed, not absorbed (the report names the flaky test).
  retries: process.env.CI ? 1 : 0,
  failOnFlakyTests: !!process.env.CI,
  timeout: 30_000,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : LOCAL_REPORTER,
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [...setup, ...PROJECTS.filter((p) => names.includes(p.name))],
})
