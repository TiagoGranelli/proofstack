import { readFileSync } from 'node:fs'
import { defineConfig } from 'vitest/config'

// Separate from vite.config.ts so tests do not load the Start/Nitro plugins.
// Projects (select with `vitest run --project <name>`):
// - `unit`: pure functions, no app (run by `pnpm check`).
// - `api`: Effect handlers through HttpApiTest with an in-memory repository and a fake session store.
// - `integration`: the running app that `pnpm verify:app` starts.

/**
 * Security-critical pure modules: `vitest run --coverage` fails unless the tests cover every line and branch
 * of each. Coverage elsewhere is reported (coverage/index.html), not gated. Add a module here
 * together with the unit tests that cover it.
 */
const COVERAGE_GATE = [
  // Where `?redirect=` may send a user after sign-in (open-redirect defense).
  'src/features/auth/utils/safe-redirect.ts',
  // Every error the UI shows goes through here; it must never render raw server output.
  'src/lib/api-error.ts',
  // The trusted-proxy client-IP resolver (plan section 2) joins here when it lands, with its unit tests.
]
for (const file of COVERAGE_GATE) {
  // A renamed file would otherwise drop out of the gate silently: a threshold glob that matches nothing passes.
  readFileSync(file)
}

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      // Generated code and vendored shadcn primitives.
      exclude: ['src/sdk/**', 'src/routeTree.gen.ts', 'src/components/ui/**', 'src/server/db/schema/auth.ts'],
      reporter: ['text-summary', 'html'],
      thresholds: Object.fromEntries(COVERAGE_GATE.map((file) => [file, { lines: 100, branches: 100 }])),
    },
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
