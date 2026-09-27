// Renders a component the way the app does: inside a TanStack Router (memory history, so links and
// navigation work without touching the page URL) and a TanStack Query client. Network calls go to the MSW
// worker (tests/component/api-mocks.ts).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { render } from 'vitest-browser-react'

/** The app's page paths, so that links and redirects under test land on a route. */
const PATHS = ['/', '/about', '/login', '/dashboard']

/** Like src/router.tsx, minus retries: a failed request shows its error state at once. */
export const testQueryClient = () =>
  new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: false }, mutations: { retry: false } } })

/**
 * Renders `ui` on every route, starting at `url`. Returns the render result plus the `router` (assert on
 * `router.state.location`) and the `queryClient` (seed or inspect the cache).
 */
export async function renderInApp(ui: ReactNode, options: { url?: string; queryClient?: QueryClient } = {}) {
  const queryClient = options.queryClient ?? testQueryClient()
  const rootRoute = createRootRoute({
    component: () => (
      <>
        {ui}
        <Outlet />
      </>
    ),
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren(
      PATHS.map((path) => createRoute({ getParentRoute: () => rootRoute, path, component: () => null })),
    ),
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
