// Renders a component the way the app does: inside a TanStack Router (memory history, so links and
// navigation work without touching the page URL) and a TanStack Query client. Network calls go to the MSW
// worker (tests/component/api-mocks.ts).
import { type QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  type AnyRoute,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { expect } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'
import { createQueryClient } from '#/lib/query-client.ts'

/** The app's page paths, so that links and redirects under test land on a route. */
const PATHS = [
  '/',
  '/about',
  '/login',
  '/sign-up',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/dashboard',
  '/account',
]

/** Like src/router.tsx (the same MutationCache), minus retries: a failed request shows its error state at once. */
export const testQueryClient = () =>
  createQueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: false }, mutations: { retry: false } } })

/**
 * Renders `ui` on every route, starting at `url`. `route` puts a real file route of src/routes at `path`
 * (its search validation, loader and component run; `ui` is usually `null` then). Returns the render result plus the `router` (assert on
 * `router.state.location`) and the `queryClient` (seed or inspect the cache).
 */
export async function renderInApp(
  ui: ReactNode,
  options: { url?: string; queryClient?: QueryClient; route?: { path: string; route: AnyRoute } } = {},
) {
  const queryClient = options.queryClient ?? testQueryClient()
  const rootRoute = createRootRoute({
    component: () => (
      <>
        {ui}
        <Outlet />
      </>
    ),
  })
  const mounted = options.route
  // Attached the way src/routeTree.gen.ts attaches it, under this test's root.
  mounted?.route.update({ id: mounted.path, path: mounted.path, getParentRoute: () => rootRoute } as never)
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      ...PATHS.filter((path) => path !== mounted?.path).map((path) =>
        createRoute({ getParentRoute: () => rootRoute, path, component: () => null }),
      ),
      ...(mounted ? [mounted.route] : []),
    ]),
    history: createMemoryHistory({ initialEntries: [options.url ?? '/'] }),
    context: { queryClient },
  })
  await router.load()
  const screen = await render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { ...screen, router, queryClient }
}

/** The text of an account form's success message (a status named by its heading `title`), without the heading. */
export const statusText = (title: string) => page.getByRole('status', { name: title }).getByRole('paragraph')

/**
 * After an account form succeeds, its button is gone: focus must land on the success message (a status named
 * by its heading), not fall back to <body>, so a keyboard user continues from there.
 */
export async function expectFocusedStatus(title: string) {
  const status = page.getByRole('status', { name: title })
  await expect.element(status).toHaveFocus()
  expect(document.activeElement).toBe(status.element())
}

/**
 * Resolves after the browser has rendered two frames. Chromium moves focus away from a focused control that
 * became disabled while it updates the rendering, so a focus assertion made only after this can see that loss.
 */
export const afterRendering = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))

/**
 * Presses a pending action's button with the keyboard (focus it, then Enter), waits until it is pending and
 * rendered, and checks that focus stayed on it: a button that is `disabled` while pending would drop a keyboard
 * user to <body>. Returns once the check passed; the caller releases the held answer.
 */
export async function pressAndKeepFocus(button: ReturnType<typeof page.getByRole>) {
  ;(button.element() as HTMLElement).focus()
  await userEvent.keyboard('{Enter}')
  await expect.element(button).toHaveAttribute('aria-disabled', 'true')
  await afterRendering()
  await expect.element(button).toHaveFocus()
}
