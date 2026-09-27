import { QueryClient } from '@tanstack/react-query'
import { createRouter } from '@tanstack/react-router'
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'
import { createIsomorphicFn, getGlobalStartContext } from '@tanstack/react-start'
import { RouteError, RouteNotFound, RoutePending } from '#/components/errors/route-error.tsx'
import { routeTree } from './routeTree.gen.ts'

// The CSP nonce created by the request middleware in src/start.ts. On the client the router reads it
// back from the <meta property="csp-nonce"> tag that HeadContent renders.
const getSsrOptions = createIsomorphicFn()
  .server(() => {
    try {
      return { nonce: getGlobalStartContext()?.cspNonce }
    } catch {
      return undefined
    }
  })
  .client(() => undefined)

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
