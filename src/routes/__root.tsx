import type { QueryClient } from '@tanstack/react-query'
import { HeadContent, Outlet, Scripts, createRootRouteWithContext } from '@tanstack/react-router'
import { RouteAnnouncer } from '#/components/layouts/route-announcer.tsx'
import { SiteFooter } from '#/components/layouts/site-footer.tsx'
import { SiteHeader } from '#/components/layouts/site-header.tsx'
import { SkipLink } from '#/components/layouts/skip-link.tsx'
import { APP_NAME, pageTitle } from '#/config/app.ts'
import { loadSession, useSessionUser } from '#/features/auth/api/get-session.ts'
import { SignOutButton } from '#/features/auth/components/sign-out-button.tsx'
import { documentHeaders, nonceSources } from '#/lib/content-security-policy.ts'
import { THEME_SCRIPT } from '#/lib/theme.ts'
import '#/styles/app.css'

const NOT_FOUND_TITLE = pageTitle('Page not found')

/**
 * Whether the page is the not-found state: a route threw notFound(), or no route matches the address (then
 * TanStack marks the match that renders the not-found page `_notFound`, a field of its public match type).
 */
const isNotFound = (matches: ReadonlyArray<{ status: string; _notFound?: boolean }>) =>
  // The leading underscore is TanStack's name for the field, not ours to change.
  // oxlint-disable-next-line eslint/no-underscore-dangle
  matches.some((match) => match.status === 'notFound' || match._notFound === true)

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  // Who the header shows as signed in (useSessionUser). A loader, not beforeLoad: loaders run after every guard, so
  // on a signed-in page this reuses the `_authed` guard's fresh read.
  loader: ({ context }) => loadSession(context.queryClient),
  // On every navigation, not only when the root is entered (never, after the first page): from the cache, so
  // free, except after a prerendered page, which has none yet. The router runs it in the background.
  shouldReload: true,
  // Every server-rendered document (pages, not-found and error states) carries the per-request nonce
  // created in src/router.tsx. Prerendered pages get a hash-based policy instead (vite.config.ts).
  // Production only: in dev, Vite injects CSS as <style> tags without the nonce.
  headers: ({ ssr }) => (import.meta.env.PROD && ssr?.nonce ? documentHeaders(nonceSources(ssr.nonce)) : undefined),
  head: ({ matches }) => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      // A page's own head() replaces this title; the not-found page has none of its own.
      { title: isNotFound(matches) ? NOT_FOUND_TITLE : APP_NAME },
      { name: 'description', content: 'Short posts with public reading and authenticated authoring.' },
      { name: 'theme-color', media: '(prefers-color-scheme: light)', content: '#ffffff' },
      { name: 'theme-color', media: '(prefers-color-scheme: dark)', content: '#0a0a0a' },
    ],
    links: [{ rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' }],
    // Before the stylesheet applies, so a chosen theme is there from the first paint (src/lib/theme.ts).
    scripts: [{ children: THEME_SCRIPT }],
  }),
  component: RootDocument,
  // Error, pending and not-found states come from the router defaults in src/router.tsx.
})

function RootDocument() {
  const user = useSessionUser()
  return (
    // The theme script sets data-theme on <html> before React hydrates it.
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      {/* data-hydrated, for E2E tests, is set by the page once its content has hydrated (Page, MarkHydrated). */}
      <body className="flex min-h-dvh flex-col bg-background text-foreground antialiased">
        <SkipLink />
        <SiteHeader user={user} signOut={<SignOutButton />} />
        <main id="main" tabIndex={-1} className="flex-1 outline-none">
          <Outlet />
          <RouteAnnouncer />
        </main>
        <SiteFooter />
        <Scripts />
      </body>
    </html>
  )
}
