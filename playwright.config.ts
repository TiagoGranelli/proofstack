import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.APP_URL ?? 'http://localhost:3000'

// Every flow runs on every project. WebKit (and with it iPhone 15) needs Ubuntu's libraries and does not run
// on every Linux host, so outside CI the default is the two desktop engines that run anywhere; `pnpm ci:local`
// and CI run all five. Choose with PW_PROJECTS: a comma-separated list of names, or `all`.
const PROJECTS = [
  { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  { name: 'Pixel 7', use: { ...devices['Pixel 7'] } },
  { name: 'iPhone 15', use: { ...devices['iPhone 15'] } },
]
const LOCAL_DEFAULT = ['chromium', 'firefox']

const requested = process.env.PW_PROJECTS?.trim() || (process.env.CI ? 'all' : LOCAL_DEFAULT.join(','))
const names = requested === 'all' ? PROJECTS.map((p) => p.name) : requested.split(',').map((n) => n.trim())
const unknown = names.filter((name) => !PROJECTS.some((p) => p.name === name))
if (unknown.length)
  throw new Error(
    `PW_PROJECTS: unknown project(s) ${unknown.join(', ')}; expected all or ${PROJECTS.map((p) => p.name).join(', ')}`,
  )

export default defineConfig({
  testDir: 'tests/e2e',
  // Playwright empties its output directory on start; test-results/app-server.log (verify:app) lives next to it.
  outputDir: 'test-results/playwright',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: PROJECTS.filter((p) => names.includes(p.name)),
})
