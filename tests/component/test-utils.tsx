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
  RouterContextProvider,
  RouterProvider,
} from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { expect, onTestFinished } from 'vitest'
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

/**
 * Renders `ui` to HTML as the server does (renderToString, inside the app's router and query client), puts it in
 * the page, and hydrates it when asked: what a visitor sees before and after the scripts run, and whether the two
 * agree (a hydration mismatch is a recoverable error React reports to `onRecoverableError`).
 */
export async function serverRendered(ui: ReactNode, options: { url?: string } = {}) {
  const { router, queryClient, unmount } = await renderInApp(null, { url: options.url ?? '/login' })
  await unmount()
  const tree = (
    <RouterContextProvider router={router}>
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
    </RouterContextProvider>
  )
  const container = document.createElement('div')
  container.innerHTML = renderToString(tree)
  document.body.append(container)
  onTestFinished(() => container.remove())
  const mismatches: unknown[] = []
  const hydrate = () => {
    const root = hydrateRoot(container, tree, { onRecoverableError: (error) => mismatches.push(error) })
    onTestFinished(() => root.unmount())
  }
  return {
    container,
    screen: page.elementLocator(container),
    form: () => container.querySelector('form')!,
    hydrate,
    mismatches,
  }
}

/** The form that `button` submits, to assert on its `aria-busy` state and its error description. */
export const formOf = (button: ReturnType<typeof page.getByRole>) =>
  page.elementLocator(button.element().closest('form')!)

/**
 * A failure the server pinned on one field: announced as an alert next to `field`, which is invalid, described by
 * it and focused, so the user can fix it at once; the form itself (the one `button` submits) is not described.
 */
export async function expectFieldIssue(
  field: ReturnType<typeof page.getByRole>,
  message: string,
  button: ReturnType<typeof page.getByRole>,
) {
  await expect.element(page.getByRole('alert')).toHaveTextContent(message)
  await expect.element(field).toHaveAttribute('aria-invalid', 'true')
  await expect.element(field).toHaveAccessibleDescription(new RegExp(`${message.replaceAll('.', '\\.')}$`))
  await expect.element(field).toHaveFocus()
  await expect.element(formOf(button)).not.toHaveAttribute('aria-describedby')
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
