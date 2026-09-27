import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.APP_URL ?? 'http://localhost:3000'

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
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
