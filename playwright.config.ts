import { defineConfig, devices } from '@playwright/test'

// The E2E test runs against the production build, served by `vite preview` on a port of its own. Playwright builds
// and starts it, and never reuses a server that is already running: it could be serving an older build.
const baseURL = 'http://localhost:4173'

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'test-results/playwright',
  forbidOnly: !!process.env.CI,
  // A retry keeps one bad run from hiding the report of the others, but a test that only passes on retry is a
  // failure in CI: flakiness is fixed, not absorbed (the report names the flaky test).
  retries: process.env.CI ? 1 : 0,
  failOnFlakyTests: !!process.env.CI,
  timeout: 30_000,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL, trace: 'retain-on-failure' },
  webServer: { command: 'pnpm build && pnpm preview', url: baseURL, reuseExistingServer: false, timeout: 60_000 },
  // More engines are one line each: `{ name: 'firefox', use: { ...devices['Desktop Firefox'] } }`, after
  // `pnpm exec playwright install firefox`.
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
