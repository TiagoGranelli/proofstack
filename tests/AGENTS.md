# tests/AGENTS.md

The test manual. Read it before you write or change a test. The root `AGENTS.md` still applies.

Test each behavior in the cheapest layer that can observe it:

| Layer | Where | Run by | For |
| --- | --- | --- | --- |
| unit | `tests/unit` | `check` | Pure functions, examples plus fast-check properties, and the repository's own rules. Modules in `COVERAGE_GATE` (`vitest.config.ts`) need 100% lines and branches |
| component | `tests/component` | `check` | React components and routes in Chromium (Vitest browser mode): states, text, what the user can do |
| e2e | `tests/e2e` | `test:e2e` | The production build in Chromium: flows, axe on every page state, keyboard and focus, ARIA landmark snapshots |

Every new function is reached by a test in the cheapest layer that can observe it, and every bug fix adds a test
that fails without the fix. Helpers are named and defined once (`tests/e2e/support/`); a test body does not stub a
project module itself. A test body holds at most 15 statements (Oxlint `max-statements`; a `describe` has no length
limit) and four nested callbacks.

## Running

- `pnpm test:unit|test:component [filter ...]` runs one fast layer; `pnpm test:fast` runs both with coverage.
- `pnpm test:e2e [filter ...]` builds the app and serves `dist/` with `vite preview` on port 4173 (Playwright's
  `webServer`, never reusing a server that is already running), then runs every spec in Chromium. Install the
  browser once: `pnpm exec playwright install chromium`. The component project uses the same Chromium.
- For a failed E2E run, open the trace: `pnpm exec playwright trace open test-results/playwright/<test>/trace.zip`
  (see [docs/agents/skills.md](../docs/agents/skills.md)).

## Rules per layer

- **Coverage.** `pnpm test:fast` writes `coverage/index.html` for all of `src` and fails unless every module in
  `COVERAGE_GATE` is fully covered (lines and branches) and the whole of `src` stays above `COVERAGE_FLOOR`, set
  a little under the measured totals. Add fully tested modules of `src/lib` to the gate with their tests; raise the
  floor when coverage grows. Components stay out of the gate: the React Compiler adds cache branches to them.
- **Properties.** Parsers, validators and anything security-relevant get fast-check properties next to their
  examples (`import * as fc from 'fast-check'`): round trips, arbitrary input never throws, invariants such as
  "two texts joined by a space count as the sum of both". When a property finds a case, add it to the examples
  too, so the failure stays named.
- **component.** Render with `render(...)` from `vitest-browser-react` and query with `page` from `vitest/browser`,
  by role and accessible name. A route renders through the real route tree on a memory history
  (`tests/component/routes.test.tsx`).
- **Accessibility.** `expectAccessible(page, '<state>')` (`tests/e2e/support/a11y.ts`) fails on any axe
  violation of WCAG 2.0/2.1/2.2 A and AA or best practices. A new page or UI state is one entry in `STATES`
  in `tests/e2e/a11y.spec.ts`, a landmark snapshot in `tests/e2e/landmarks.spec.ts`, and, if it has controls, a row
  in the tab-order table of `tests/e2e/keyboard.spec.ts` (`tests/unit/route-coverage.test.ts` fails for a page
  route without all three; it recognizes `visit(page, '/path')`). `tabOrder` records every Tab stop, its accessible
  name and visible focus, and fails on a focus trap: it walks until a temporary sentinel after the last control,
  because what a browser does past the last control differs by engine.
- **E2E.** Open pages with `visit(page, path)` (`tests/e2e/support/app.ts`): the app renders in the browser, so it
  waits for the page's `h1` before the test interacts.
- **Flakiness.** CI retries a failed Playwright test once but fails the run if it then passes
  (`failOnFlakyTests`): fix the cause. Locate fields by role and exact name (`getByRole('textbox', { name:
  'Email', exact: true })`); a bare `getByLabel('Email')` also matches "Email confirmed". A fixed wait
  (`setTimeout`, `sleep`, `waitForTimeout`) fails Oxlint in the browser layers: wait for the condition itself.
