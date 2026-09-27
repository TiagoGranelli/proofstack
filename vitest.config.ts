import { defineConfig } from 'vitest/config'

// Separate from vite.config.ts so tests do not load the Start/Nitro plugins.
// Projects (select with `vitest run --project <name>`):
// - `unit`: pure functions, no app (run by `pnpm check`).
// - `api`: Effect handlers through HttpApiTest with an in-memory repository and a fake session store.
// - `integration`: the running app that `pnpm verify:app` starts.

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
          name: 'api',
          include: ['tests/api/**/*.test.ts'],
          // src/server/env.ts validates the environment when it is imported, and the handlers import the
          // database client and Better Auth. These values pass that validation; nothing connects to them
          // (the harness replaces the repository and the session check).
          env: {
            DATABASE_URL: 'postgres://unused:unused@127.0.0.1:9/unused',
            APP_URL: 'http://localhost:3000',
            BETTER_AUTH_SECRET: 'api-handler-tests-only-not-a-secret-000',
            TRUSTED_IP_HEADER: '',
            NODE_ENV: 'test',
          },
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
