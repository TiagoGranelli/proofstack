import { readFileSync } from 'node:fs'
import babel from '@rolldown/plugin-babel'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

// Projects (select with `vitest run --project <name>`):
// - `unit`: pure functions, in Node.
// - `component`: React components in Chromium (Vitest browser mode), with the app's React transform.
// `pnpm check` runs both with coverage (the `tests` job in .config/lefthook.yml). The E2E test is Playwright's
// (playwright.config.ts).

/**
 * Modules that must stay fully covered: `vitest run --coverage` (`pnpm test:fast`, part of `pnpm check`) fails
 * unless the unit and component tests together cover every line and branch of each. Add a module here together
 * with the tests that cover it; everything else only has to stay above the global floor (COVERAGE_FLOOR).
 * Components stay out: the React Compiler adds cache branches to them that no test can reach on purpose.
 */
const COVERAGE_GATE = ['src/lib/count-words.ts']
/**
 * Whole-project floor, a little under the measured coverage of `pnpm test:fast`: it only stops a regression, such
 * as a module added without tests. Raise it when coverage grows.
 */
// Measured lines 90.4%, branches 59.5%, functions 100%, statements 78.8% when set. src/main.tsx only runs in the
// E2E tests, and most untaken branches are the React Compiler's cache checks.
const COVERAGE_FLOOR = { lines: 89, branches: 58, functions: 100, statements: 77 }
for (const file of COVERAGE_GATE) {
  // A renamed file would otherwise drop out of the gate silently: a threshold glob that matches nothing passes.
  readFileSync(file)
}

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
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
        // The same React transform as the app (vite.config.ts), so components run as they ship.
        plugins: [react(), babel({ presets: [reactCompilerPreset()] })],
        // Pre-bundled up front: discovering them during the run makes Vite reload the page mid-test.
        optimizeDeps: {
          include: [
            'react',
            'react/jsx-dev-runtime',
            'react-dom/client',
            '@tanstack/react-router',
            'vitest-browser-react',
          ],
        },
        test: {
          name: 'component',
          include: ['tests/component/**/*.test.tsx'],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
            screenshotFailures: false,
          },
          testTimeout: 10_000,
        },
      },
    ],
  },
})
