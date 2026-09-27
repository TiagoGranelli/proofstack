import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import babel from '@rolldown/plugin-babel'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import { playwright } from '@vitest/browser-playwright'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

// Separate from vite.config.ts so tests do not load the Start/Nitro plugins.
// Projects (select with `vitest run --project <name>`):
// - `unit`: pure functions, no app.
// - `api`: Effect handlers through HttpApiTest with an in-memory repository and a fake session store.
// - `component`: React components in Chromium (Vitest browser mode), network mocked by MSW.
// - `integration`: the running app that `pnpm verify:app` starts.
// `pnpm check` runs unit, api and component (see scripts/check.ts); `pnpm verify:app` runs integration.

/**
 * Security-critical pure modules: `vitest run --coverage` (`pnpm test:fast`, part of `pnpm check`) fails
 * unless the tests cover every line and branch of each. Coverage elsewhere is reported
 * (coverage/index.html), not gated. Add a module here together with the unit tests that cover it.
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

/**
 * Serves MSW's worker script to the browser tests straight from the installed package, so it always matches
 * the library version and never sits in public/ (which would ship it with the app).
 */
const mswWorkerScript = (): Plugin => ({
  name: 'proofstack:msw-worker-script',
  configureServer(server) {
    const script = createRequire(import.meta.url).resolve('msw/mockServiceWorker.js')
    server.middlewares.use('/mockServiceWorker.js', (_req, res) => {
      res.setHeader('content-type', 'text/javascript')
      res.end(readFileSync(script))
    })
  },
})

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
        // The same React transform as the app (vite.config.ts), so components run as they ship.
        plugins: [react(), babel({ presets: [reactCompilerPreset()] }), mswWorkerScript()],
        // Pre-bundled up front: discovering them during the run makes Vite reload the page mid-test.
        optimizeDeps: {
          include: [
            'react',
            'react/jsx-dev-runtime',
            'react-dom/client',
            '@tanstack/react-query',
            '@tanstack/react-router',
            'better-auth/react',
            'class-variance-authority',
            'cn',
            'radix-ui',
            'msw',
            'msw/browser',
            'vitest-browser-react',
          ],
        },
        resolve: {
          alias: [
            {
              find: '#/lib/api-client.ts',
              replacement: fileURLToPath(new URL('./tests/component/stubs/api-client.ts', import.meta.url)),
            },
          ],
        },
        test: {
          name: 'component',
          include: ['tests/component/**/*.test.tsx'],
          setupFiles: ['tests/component/setup.ts'],
          browser: {
            enabled: true,
            headless: true,
            // Playwright's Chromium, or CHROME_PATH like verify:app and lighthouse.
            provider: playwright({ launchOptions: { executablePath: process.env.CHROME_PATH || undefined } }),
            instances: [{ browser: 'chromium' }],
            screenshotFailures: false,
          },
          testTimeout: 10_000,
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
