import type { QueryClient } from '@tanstack/react-query'
import { HeadContent, Outlet, Scripts, createRootRouteWithContext, useHydrated } from '@tanstack/react-router'
import { SiteHeader } from '#/components/layouts/site-header.tsx'
import { APP_NAME } from '#/config/app.ts'
import { documentHeaders, nonceSources } from '#/lib/content-security-policy.ts'
import '#/styles/app.css'

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  // Every server-rendered document (pages, not-found and error states) carries the per-request nonce
  // created in src/router.tsx. Prerendered pages get a hash-based policy instead (vite.config.ts).
  // Production only: in dev, Vite injects CSS as <style> tags without the nonce.
  headers: ({ ssr }) => (import.meta.env.PROD && ssr?.nonce ? documentHeaders(nonceSources(ssr.nonce)) : undefined),
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: APP_NAME },
      { name: 'description', content: 'Short posts with public reading and authenticated authoring.' },
      { name: 'theme-color', content: '#ffffff' },
    ],
    links: [{ rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' }],
  }),
  component: RootDocument,
  // Error, pending and not-found states come from the router defaults in src/router.tsx.
})

function RootDocument() {
  // Exposed for E2E tests: interactions before hydration are silently lost.
  const hydrated = useHydrated()
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body
        className="min-h-dvh bg-background text-foreground antialiased"
        data-hydrated={hydrated ? 'true' : undefined}
      >
        <SiteHeader />
        <Outlet />
        <Scripts />
      </body>
    </html>
  )
}
