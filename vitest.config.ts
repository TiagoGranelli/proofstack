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
// - `db`: server modules against a real, freshly migrated Postgres (no build, no app): the rate-limit storage and
//   query budgets. `pnpm test:db`; also run by `pnpm verify:app`.
// - `integration`: the built app over HTTP; its global setup starts the servers (`pnpm test`).
// `pnpm check` runs unit, api and component (the `tests` job in lefthook.yml); `pnpm verify:app` runs db and
// integration.

/**
 * Security-critical and fully tested modules: `vitest run --coverage` (`pnpm test:fast`, part of
 * `pnpm check`) fails unless the unit, api and component tests together cover every line and branch of each.
 * Add a module here together with the tests that cover it; everything else only has to stay above the
 * global floor (COVERAGE_FLOOR).
 */
const COVERAGE_GATE = [
  // Where `?redirect=` may send a user after sign-in (open-redirect defense).
  'src/features/auth/utils/safe-redirect.ts',
  // Every error the UI shows goes through here; it must never render raw server output.
  'src/lib/api-error.ts',
  // The same for every failed account action (sign-in, sign-up, password, sessions, delete account).
  'src/features/auth/utils/describe-auth-failure.ts',
  // The X-Forwarded-For value Better Auth resolves the client IP from (rate limits, sessions).
  'src/server/http/forwarded-for.ts',
  // The client address a session shows (IPv6 as the network Better Auth kept).
  'src/server/http/client-address.ts',
  // How the account page names a session's device, address and times.
  'src/features/auth/utils/describe-session.ts',
  // Every handler branch of the business API (tests/api).
  'src/server/api/handlers.ts',
  // Shutdown order: the pool must outlive every task that still queries it.
  'src/server/lifecycle.ts',
  // The text of every account email (links, expiry).
  'src/server/mail/auth-messages.ts',
  // Startup validation of every setting: TRUSTED_PROXIES, AUTH_SIGN_UP, APP_URL, SMTP and the rest.
  'src/server/env.ts',
  // The Content-Security-Policy of every HTML document.
  'src/lib/content-security-policy.ts',
]
/**
 * Whole-project floor, a little under the measured coverage of `pnpm test:fast`: it only stops a regression, such
 * as a module added without tests. Raise it when coverage grows.
 */
// Measured lines 70.4%, branches 68.5%, functions 60.3%, statements 70.3% when set.
const COVERAGE_FLOOR = { lines: 69, branches: 67, functions: 59, statements: 69 }
for (const file of COVERAGE_GATE) {
  // A renamed file would otherwise drop out of the gate silently: a threshold glob that matches nothing passes.
  readFileSync(file)
}

/**
 * Serves MSW's worker script to the browser tests straight from the installed package, so it always matches
 * the library version and never sits in public/ (which would ship it with the app).
 */
const mswWorkerScript = (): Plugin => ({
  name: 'msw-worker-script',
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
      thresholds: {
        ...COVERAGE_FLOOR,
        ...Object.fromEntries(COVERAGE_GATE.map((file) => [file, { lines: 100, branches: 100 }])),
      },
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
            TRUSTED_PROXIES: '',
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
            'react-dom/server',
            '@tanstack/react-form',
            '@tanstack/react-query',
            '@tanstack/react-router',
            'effect',
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
            {
              find: '#/lib/auth.functions.ts',
              replacement: fileURLToPath(new URL('./tests/component/stubs/auth-functions.ts', import.meta.url)),
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
          name: 'db',
          include: ['tests/db/**/*.test.ts'],
          // Creates a fresh, migrated app_db_<pid>_test next to DATABASE_URL (or .env's) and hands its URL
          // to the workers as DATABASE_URL; dropped afterwards. Needs Postgres, no build, no running app.
          globalSetup: ['tests/db/global-setup.ts'],
          // Everything src/server/env.ts requires except DATABASE_URL (see the global setup). Outgoing mail
          // stays off whatever .env says: nothing here sends any.
          env: {
            APP_URL: 'http://localhost:3000',
            BETTER_AUTH_SECRET: 'db-tests-only-not-a-secret-0000000000',
            TRUSTED_PROXIES: '',
            AUTH_SIGN_UP: 'closed',
            SMTP_URL: '',
            MAIL_FROM: '',
            NODE_ENV: 'test',
          },
          testTimeout: 15_000,
          hookTimeout: 30_000,
        },
      },
      {
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          // Starts the built app's two servers on a fresh database and hands them over (`inject('servers')`);
          // setup.ts gives each worker the app's environment. Needs `pnpm build`, Postgres and Mailpit.
          globalSetup: ['tests/integration/global-setup.ts'],
          setupFiles: ['tests/integration/setup.ts'],
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
