# Review instructions

For AI reviewers of pull requests (Claude Code Review reads this file; other tools can be pointed at it).
`AGENTS.md` describes the architecture; this file says what to flag and how hard.

## Do not report

- Generated and vendored files: `src/sdk/**`, `openapi.json`, `src/routeTree.gen.ts`, `drizzle/meta/**`,
  `pnpm-lock.yaml`, `skills-lock.json`, `.agents/skills/shadcn/**`, `.repos/**`. Review their sources instead
  (`src/contract`, `src/routes`, `src/server/db/schema`, `package.json`). A hand edit of a generated file is
  Important.
- What CI already enforces: formatting, lint, types, Effect diagnostics, dead code, complexity, duplication,
  licenses, route accessibility coverage, the syntax rules in `.oxlintrc.json` and the repository rules in
  `tests/unit/repo-policy.test.ts`.
- The hidden eval checks in `.agents/evals/tasks/*/tests/`, whose imports resolve only after
  `.agents/evals/grade.sh` copies them.

## What Important means here

Reserve Important for these; everything else is a Nit at most.

- **Auth bypass.** A business operation outside the `Authentication` middleware, or an operation added to
  `PUBLIC_OPERATIONS` (`tests/api/public-operations.test.ts`) without a reason. Authorization that relies on the `_authed` route
  guard (a UX redirect only). A query on user data whose `WHERE` does not include the owner. A browser-triggered
  account action through `auth.api.*` instead of `callAuthEndpoint`, a Better Auth endpoint added to
  `HTTP_ENDPOINTS` when `EXPOSED` would do, or a server function whose validator is not Effect Schema. A new raw
  server route, a CORS header, or a change that weakens the origin check in `src/start.ts`.
- **Contract drift.** `src/contract` changed without the matching `openapi.json` and `src/sdk` in the same PR; a
  new tagged error without its message in `src/lib/api-error.ts`; a declared status that no test provokes; a
  handler that answers a status its endpoint does not declare.
- **Log and secret leaks.** Logging request bodies, headers, cookies, tokens, passwords or full error objects
  around `src/server/log.ts` (which keeps only the first line of a message because pg and Drizzle append SQL
  parameters); a secret in a `VITE_*` variable; raw server output shown to users instead of `describeApiError` or
  `describeAuthFailure`; a secret committed anywhere.
- **Missing tests.** A new endpoint without API-layer tests for each branch and status (`tests/api`); a new page
  or UI state without its axe state, landmark snapshot and tab-order row (`tests/e2e/a11y.spec.ts`,
  `tests/e2e/landmarks.spec.ts`, `tests/e2e/keyboard.spec.ts`); a new UI state without a component test; a bug
  fix without a test that fails before it.
- **Query budget.** A new or changed repository method without a budget in its
  `tests/db/<feature>-query-budget.test.ts`, or a list whose number of statements grows with the number of rows
  (N+1).
- **Migrations.** An edit to a migration already in `drizzle/meta/_journal.json` on the base branch, or a
  statement that locks a busy table without the reasoned `-- squawk-ignore` the migration lint asks for.
- **CSP.** Inline `style` attributes, inline event handlers, or `'unsafe-inline'` in a policy.

## Evidence

Every finding cites `file:line` in the diff or the code it calls. Claims about behavior need the code path, not an
inference from a name. When a test covers the case, name it.

## Volume

Report at most five Nits. If there are more, say "plus N similar" in the summary. After the first review of a
PR, report only Important findings. Open the summary with the count of Important findings, or "No blocking
issues."
