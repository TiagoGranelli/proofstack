# The `minimal` branch

`minimal` is `main` without the posts example: the same foundation (auth, the account pages, `GET /api/me`,
every gate), a plain home page, and a dashboard that reads `GET /api/me`. Adopters who start without the
example take it ([adopting.md](adopting.md#day-1)); maintainers keep it in sync by merging `main` into it
([CONTRIBUTING.md](../CONTRIBUTING.md#the-minimal-branch)).

This page is the exact recipe, for building the branch once and for checking a merge. The same list is what
an adopter removes to drop the example from a `main`-based app later. Every step keeps `pnpm check`,
`pnpm check:drift` and `pnpm verify:app` passing on the result; the measured values below are from the first
build and move as the code does.

## Delete

- `src/contract/posts.ts`, `src/contract/post-input.ts` (the post body schema the post forms share with the
  API), `src/server/posts/`, `src/server/db/schema/posts.ts`, `src/features/posts/` (the composer and editor with
  their lazily loaded schema, `post-draft.ts` and `post-draft-schema.ts`, and the post mutations' `meta`
  invalidation in `api/posts-cache.ts`)
- `src/components/ui/card.tsx`, `src/components/ui/textarea.tsx` (only the example uses them;
  `pnpm exec shadcn add card textarea` brings them back)
- Tests: `tests/api/posts.test.ts`, `tests/api/posts-repo.ts`, `tests/api/posts-validation.test.ts`,
  `tests/component/my-post.test.tsx`, `tests/component/post-composer.test.tsx`,
  `tests/component/post-list.test.tsx`, `tests/db/posts-query-budget.test.ts` (the repository's query budgets
  and the uuidv7 id check), `tests/db/post-schema.test.ts` (the table's CHECK, keyset indexes and database clock),
  `tests/integration/posts.test.ts` (with the NUL-body case),
  `tests/integration/posts-pagination.test.ts`, `tests/integration/posts-rate-limit.test.ts`,
  `tests/e2e/posts-pagination.spec.ts`, `tests/e2e/seed.setup.ts`, `tests/unit/page-cursor.test.ts`

## Edit

Application code:

- `src/contract/api.ts`: drop `.add(PublicPosts)`, `.add(MyPosts)` and their import.
- `src/contract/limits.ts`: drop `POST_MAX_LENGTH`, `POSTS_PAGE_DEFAULT`, `POSTS_PAGE_MAX`.
- `src/lib/api-error.ts`: drop the `PostNotFound` case. The `ValidationError` and `RateLimited` cases stay:
  they are always part of the union (`MiddlewareError`).
- `src/server/api/handlers.ts`: drop `pageRequest`, `PublicPostsHandlers`, `MyPostsHandlers` and the posts
  imports.
- `src/server/api/web-handler.ts`: drop `PublicPostsHandlers`, `MyPostsHandlers` and the `PostsRepo` layer.
- `src/server/db/schema/index.ts`: drop `export * from './posts.ts'`.
- `src/routes/__root.tsx`: the description becomes
  ``{ name: 'description', content: `${APP_NAME}: sign in to reach your dashboard.` }``.

Scripts and configuration:

- `scripts/check.ts`: drop `'GET /api/posts'` from `PUBLIC_OPERATIONS`.
- `scripts/lighthouse.ts`: drop `POSTS`, `seedPosts` and its call (and the imports only they used).
- `scripts/route-coverage.ts`: drop the `dashboardWithMyPost` and `'/api/posts'` entries of `HELPERS`.
- `playwright.config.ts`: `const setup: Array<{ name: string; testMatch: RegExp }> = []` (no `seed` project).
- `vitest.config.ts`: `COVERAGE_FLOOR = { lines: 64, branches: 61, functions: 56, statements: 63 }` (measured
  65.5 %, 62.2 %, 57.8 %, 64.9 % without the example).
- `tests/contract-coverage-allowlist.json`: drop the `"*"` / `403` entry. Without write operations nothing in
  the contract answers the CSRF check's 403, so the entry would be stale; [adopting.md](adopting.md#your-first-feature)
  says how to bring it back.

Tests:

- `tests/unit/stored-text.test.ts`: drop the post body case and the `PostInput` import. `isFreeOfNul` stays: the
  account inputs (name, email, tokens) still use it.
- `tests/db/transaction.test.ts`: its writes go through `PostsRepo`. `Database.transaction` stays, so keep the
  test and write through `Database.client` into a table that stays (for example `verification`).
- `tests/api/database-down.test.ts`: drop the `publicPosts.*` and `myPosts.*` entries of `EXPECTED`.
- `tests/api/harness.ts`: drop `PublicPostsHandlers`, `MyPostsHandlers` and `memoryPostsRepo`.
- `tests/api/memory-db.ts`: drop `clockStepMicros` from `RepoOptions`.
- `tests/component/api-mocks.ts`: drop the posts entries of `ErrorsByOperation` and the `post`, `postPage`,
  `postPages` factories.
- `tests/component/api-error-alert.test.tsx` and `tests/unit/api-error.test.ts`: drop the `PostNotFound` cases.
- `tests/component/error-boundaries.test.tsx`: drop the section-boundary test that mounts `PostComposer` and
  `MyPostList`, and replace the two dashboard tests with:

  ```tsx
  it('names what failed when the dashboard cannot load the signed-in user', async () => {
    worker.use(apiFailure('meGet', { network: true }))
    await renderInApp(null, { url: '/dashboard', route: { path: '/dashboard', route: DashboardRoute } })
    await expect.element(page.getByRole('heading', { level: 1 })).toHaveTextContent('Your dashboard could not be loaded')
    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent('Could not load your dashboard. Check your connection and try again.')
    await expect.element(tryAgain()).toBeEnabled()
    await expect.element(page.getByRole('link', { name: 'Go to the home page' })).toHaveAttribute('href', '/')
  })

  it('offers to sign in when the dashboard hit an ended session', async () => {
    worker.use(apiError('meGet', 401, { _tag: 'Unauthorized', message: 'Authentication required' }))
    await renderInApp(null, { url: '/dashboard', route: { path: '/dashboard', route: DashboardRoute } })
    await expect
      .element(page.getByRole('alert').getByRole('link', { name: 'Sign in' }))
      .toHaveAttribute('href', '/login?redirect=%2Fdashboard')
  })
  ```

- `tests/e2e/support/app.ts`: drop `seedPost`, `fakePost`, `lastPage`, `dashboardWithMyPost`, `overTheLimit`,
  `PAGINATED_AUTHOR` and the header bullet about the shared public list; `PAGE_LINK` becomes
  `{ '/api/me': 'Dashboard' }`.
- `tests/e2e/flows.spec.ts`: drop the post helpers (`exactly` through `publicListFrames`) and the three posts
  tests (publish/edit/delete, rejected save, client-side navigation).
- `tests/e2e/a11y.spec.ts`, in `STATES`: replace the three `home…` states with `home`, the posts dashboard
  states with `dashboard` and `dashboard, loading`, and `error page` with the dashboard's error page:

  ```ts
  home: async ({ page }) => {
    await visit(page, '/')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  },
  dashboard: async ({ page, author }) => {
    await signIn(page, author)
    await visit(page, '/dashboard')
    await expect(page.getByText(`Signed in as ${author.name}`)).toBeVisible()
  },
  'dashboard, loading': async ({ page, author }) => {
    // The pending screen replaces a navigation that takes longer than a second.
    await signIn(page, author)
    await visit(page, '/about')
    await page.route('**/api/me', () => {})
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Dashboard' }).click()
    await expect(page.getByText('Loading…')).toBeVisible()
  },
  'error page': async ({ page, author }) => {
    await signIn(page, author)
    await navigateWithApiResponse(page, '/api/me', {
      status: 503,
      json: { _tag: 'ServiceUnavailable', message: 'Database unavailable' },
    })
    await expect(page.getByRole('heading', { name: 'Your dashboard could not be loaded' })).toBeVisible()
  },
  ```

  In `landmarks`: `home` expects `` `${SITE_HEADER}\n- main:\n  - heading "${APP_NAME}" [level=1]\n  - paragraph` ``;
  `dashboard` visits `/dashboard` signed in and expects
  `` `${SITE_HEADER}\n- main:\n  - heading "Dashboard" [level=1]\n  - link "Account"\n  - button "Sign out"\n  - paragraph` ``;
  `error page` uses `navigateWithApiResponse(page, '/api/me', { status: 503, json: {} })`.
- `tests/e2e/keyboard.spec.ts`: the `home` row expects `NAV` only; the `error page` row navigates with
  `'/api/me'`; the `dashboard` row visits `/dashboard` signed in and expects
  `[...NAV, 'link "Account"', 'button "Sign out"']`; drop the `editing from the keyboard` block and the
  "publishing and deleting are announced" test.

## Add

`src/routes/index.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { APP_NAME } from '#/config/app.ts'

export const Route = createFileRoute('/')({
  head: () => ({ meta: [{ title: APP_NAME }] }),
  // The HTML carries a per-request CSP nonce, so shared caches must not store it; browsers revalidate.
  headers: () => ({ 'cache-control': 'private, no-cache' }),
  component: Home,
})

function Home() {
  return (
    <main className="mx-auto grid max-w-2xl gap-3 p-4">
      <h1 className="text-2xl font-semibold">{APP_NAME}</h1>
      <p>Your app starts here. Sign in to see the dashboard, or replace this page with your own.</p>
    </main>
  )
}
```

`src/features/auth/api/get-me.ts`:

```ts
import { apiClient } from '#/lib/api-client.ts'
import { meGetOptions } from '#/sdk/@tanstack/react-query.gen.ts'

/** The signed-in user (GET /api/me). Isomorphic: in-process during SSR, same-origin fetch in the browser. */
export const getMeQueryOptions = () => meGetOptions({ client: apiClient() })
```

`src/routes/_authed/dashboard.tsx`:

```tsx
import { useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { RouteError } from '#/components/errors/route-error.tsx'
import { pageTitle } from '#/config/app.ts'
import { getMeQueryOptions } from '#/features/auth/api/get-me.ts'
import { useSignOut } from '#/features/auth/api/sign-out.ts'
import { SignOutAlert, SignOutButton } from '#/features/auth/components/sign-out-button.tsx'

// The signed-in start page. Its data comes through the contract like any feature's: GET /api/me, in-process
// during SSR and over HTTP in the browser.
export const Route = createFileRoute('/_authed/dashboard')({
  loader: ({ context }) => context.queryClient.query({ ...getMeQueryOptions(), staleTime: 'static' }),
  head: () => ({ meta: [{ title: pageTitle('Dashboard') }, { name: 'robots', content: 'noindex' }] }),
  errorComponent: (props) => (
    <RouteError {...props} title="Your dashboard could not be loaded" action="load your dashboard" />
  ),
  component: Dashboard,
})

function Dashboard() {
  const { data: me } = useSuspenseQuery(getMeQueryOptions())
  const navigate = useNavigate()
  const signOut = useSignOut({ mutationConfig: { onSuccess: () => navigate({ to: '/' }) } })
  return (
    <main className="mx-auto grid max-w-2xl gap-6 p-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <div className="flex items-center gap-4">
          <Link to="/account" className="text-sm underline underline-offset-4">
            Account
          </Link>
          <SignOutButton signOut={signOut} />
        </div>
      </div>
      <SignOutAlert signOut={signOut} />
      <p>
        Signed in as {me.name} ({me.email}).
      </p>
    </main>
  )
}
```

## Generate

1. `pnpm db:generate --name remove_example`: a migration with `DROP TABLE "post" CASCADE;`. It comes after
   `0009_post_body_check_validate`: the example's migrations (0000's `post` table, 0001, 0002, and 0007 to 0009:
   the `uuidv7()` default, the ascending keyset indexes and the body CHECK) stay in the journal, because
   databases may have applied them (the `applied-migrations` guard). Dropping the table drops its constraint
   and indexes with it. Put the migration
   lint's waiver above the statement:

   ```sql
   -- The example feature is gone: nothing reads or writes this table.
   -- squawk-ignore ban-drop-table
   ```

2. `pnpm codegen`: `openapi.json` and `src/sdk/` without the posts operations.
3. `pnpm format`, then `pnpm check`, `pnpm check:drift`, `pnpm build && pnpm verify:app`.

Re-measure the coverage floor in `vitest.config.ts` after the merge instead of copying the numbers above: C4's
forms and the lazy validators moved them.

`git grep -n -i -w -e posts -e post -- ':!*.md'` then lists what is left of the example outside docs: the
`POST` method, `postgres` and a few comments that use a post only as an illustration. Docs (`AGENTS.md`, the
skills, `docs/`) mention the example in places; on `minimal`, reword them where they would mislead: the forms
convention in `src/features/AGENTS.md` and the `add-feature` skill cite `src/contract/post-input.ts`, and ADR
0014 (uuidv7 ids, keyset lists) describes the post table, which is also the rule for the next table.
