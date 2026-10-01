# tests/e2e/AGENTS.md

The E2E layer. [tests/AGENTS.md](../AGENTS.md) still applies.

- **Accessibility.** `expectAccessible(page, '<state>')` (`tests/e2e/support/a11y.ts`) fails on any axe
  violation of WCAG 2.0/2.1/2.2 A and AA or best practices. A new page or UI state is one entry in `STATES`
  in `tests/e2e/a11y.spec.ts`, a landmark snapshot in `tests/e2e/landmarks.spec.ts`, and, if it has controls, a row
  in the tab-order table of `tests/e2e/keyboard.spec.ts` (`tests/unit/route-coverage.test.ts` fails for a page
  route without all three; it recognizes `visit(page, '/path')` and the helpers listed in
  `scripts/route-coverage.ts`). `tabOrder` records each Tab stop, its name and visible focus, and fails on a
  focus trap; `expectTabStops` checks the header and footer exactly and a row's own controls in order
  with others between, so a new section on a page breaks no other state's row.
  `navigateWithApiResponse(page, '/api/posts' | '/api/me/posts', response)` (`tests/e2e/support/app.ts`)
  reaches empty and failure states by answering the browser's API call on a client-side navigation; build
  list bodies with `lastPage(...)` so they match the contract's `PostPage`.
- **E2E hydration and CSP.** Wait for hydration before interacting, with `visit`, `followLink` or
  `expectHydrated(page)` (`support/app.ts`; `Page` sets `body[data-hydrated="true"]`): input before hydration is
  lost, and a bare `expect(...)` gives a busy machine only 5 s. Import `test` and `expect` from `tests/e2e/fixtures.ts`, not `@playwright/test`: it
  fails the test on any Content-Security-Policy violation.
- **E2E isolation.** Specs run in parallel on one database and never depend on each other's data. Import
  `test` from `tests/e2e/support/app.ts`: every worker gets its own `author` (created verified through
  `scripts/create-user.ts`) and every browser and API context its own client IP (sign-in rate limit).
  Flows that change or delete an account use a throwaway one instead: `createAccount` from
  `tests/e2e/support/accounts.ts` (created verified the same way), and a
  second signed-in browser comes from `newClient`, which gets its own client IP too.
  Find your posts by a unique body. Data several specs need is written once by the `seed` project
  (`tests/e2e/seed.setup.ts`), which runs before the browser projects; today that is more than a page of
  posts by an author only `posts-pagination.spec.ts` reads (`PAGINATED_AUTHOR`). Never publish many posts
  from a spec: a post published moments ago must stay on the first page of `/`.

The servers E2E runs against, and the environment its workers get: [integration/AGENTS.md](../integration/AGENTS.md).
