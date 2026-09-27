import type { QueryClient } from '@tanstack/react-query'
import {
  Asset,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  useHydrated,
  useRouter,
  useTags,
} from '@tanstack/react-router'
import { SiteHeader } from '#/components/layouts/site-header.tsx'
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
      { title: 'ProofStack' },
      { name: 'description', content: 'Short posts with public reading and authenticated authoring.' },
      { name: 'theme-color', content: '#ffffff' },
    ],
    links: [{ rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' }],
  }),
  component: RootDocument,
  // Error, pending and not-found states come from the router defaults in src/router.tsx.
})

// HeadContent minus Start's <link rel="modulepreload"> hints. Those start ~110 KB (brotli) of hydration JS
// before the first paint and compete with the server-rendered HTML on slow connections: Lighthouse mobile
// FCP went from 1.8 s to 1.5 s without them (1.35 s with inlined CSS). The trade-off is that the entry
// script's imports are discovered one round trip later, so hydration finishes slightly later.
function Head() {
  const tags = useTags()
  const nonce = useRouter().options.ssr?.nonce
  return tags
    .filter((tag) => !(tag.tag === 'link' && tag.attrs?.rel === 'modulepreload'))
    .map((tag) => <Asset {...tag} key={`tsr-meta-${JSON.stringify(tag)}`} nonce={nonce} />)
}

function RootDocument() {
  // Exposed for E2E tests: interactions before hydration are silently lost.
  const hydrated = useHydrated()
  return (
    <html lang="en">
      <head>
        <Head />
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
