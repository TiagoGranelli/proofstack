import { QueryClient } from '@tanstack/react-query'
import { createRouter } from '@tanstack/react-router'
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'
import { createIsomorphicFn } from '@tanstack/react-start'
import { RouteError } from '#/components/errors/route-error.tsx'
import { RouteNotFound } from '#/components/errors/route-not-found.tsx'
import { RoutePending } from '#/components/layouts/route-pending.tsx'
import { routeTree } from './routeTree.gen.ts'

// A fresh CSP nonce per request (Start's documented pattern, TanStack/router e2e/react-start/csp). The router
// stamps it on every script, style and preload it renders, and the root route's `headers` puts it into the
// Content-Security-Policy. In the browser the router reads it back from the <meta property="csp-nonce"> tag
// that HeadContent renders, and Vite's preload helper copies it onto the chunks it preloads.
const getSsrOptions = createIsomorphicFn().server(() => {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return { nonce: Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('') }
})

// Called once per request on the server, so every request gets its own QueryClient and no cached
// query (such as another user's posts) can leak between requests.
export function getRouter() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } })
  const router = createRouter({
    routeTree,
    context: { queryClient },
    // Navigation is stale-while-revalidate (the router default): a revisited route renders its cached data
    // at once and refetches in the background. A route whose data this tab just changed waits for the new
    // data in its beforeLoad instead (src/routes/index.tsx), so no global blocking reload is needed.
    defaultPreload: 'intent',
    defaultErrorComponent: RouteError,
    defaultPendingComponent: RoutePending,
    defaultNotFoundComponent: RouteNotFound,
    scrollRestoration: true,
    ssr: getSsrOptions(),
  })
  setupRouterSsrQueryIntegration({ router, queryClient })
  return router
}
