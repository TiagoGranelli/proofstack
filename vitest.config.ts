import { defineConfig } from 'vitest/config'

// Separate from vite.config.ts so tests do not load the Start/Nitro plugins.
// Two projects: `unit` (pure functions, no app, run by `pnpm check`) and `integration` (the running app
// that `pnpm verify:app` starts). Select one with `vitest run --project <name>`.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          testTimeout: 5_000,
        },
      },
      {
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          // Refuses to run without the app that `pnpm verify:app` starts (APP_URL, TEST_USER_*).
          globalSetup: ['tests/integration/global-setup.ts'],
          // Files share only the server. Each one signs in from its own client IP (X-Forwarded-For), so they
          // cannot exhaust each other's sign-in rate limit, and they only assert on posts they created.
          fileParallelism: true,
          // Generous for a loaded CI runner or laptop; a healthy run finishes every test in well under a second.
          testTimeout: 15_000,
          hookTimeout: 15_000,
        },
      },
    ],
  },
})
