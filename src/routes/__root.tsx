import type { QueryClient } from '@tanstack/react-query'
import {
  Asset,
  Link,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  useHydrated,
  useRouter,
  useTags,
} from '@tanstack/react-router'
import '#/styles/app.css'

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
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

const navLink =
  'rounded-sm text-muted-foreground outline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring data-[status=active]:text-foreground'

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
        <header className="border-b">
          <nav aria-label="Main" className="mx-auto flex max-w-2xl gap-4 p-4 text-sm">
            <Link to="/" className={`${navLink} font-semibold`}>
              ProofStack
            </Link>
            <Link to="/about" className={navLink}>
              About
            </Link>
            <Link to="/dashboard" className={`${navLink} ml-auto`}>
              Dashboard
            </Link>
          </nav>
        </header>
        <Outlet />
        <Scripts />
      </body>
    </html>
  )
}
