import { createRootRoute, HeadContent, Link, Outlet } from '@tanstack/react-router'

export const Route = createRootRoute({
  head: () => ({ meta: [{ title: 'Word counter' }] }),
  component: RootLayout,
  notFoundComponent: NotFound,
})

// The link to the current page reads bold; the router marks it with aria-current="page".
const NAV_LINK = 'rounded-sm underline-offset-4 hover:underline aria-[current=page]:font-semibold'

// React 19 moves the <title> that HeadContent renders into <head>, so each route's `head()` names its page.
function RootLayout() {
  return (
    <>
      <HeadContent />
      <header className="border-b border-neutral-200 dark:border-neutral-800">
        <nav aria-label="Main" className="mx-auto flex max-w-2xl gap-6 px-4 py-3">
          <Link to="/" className={NAV_LINK}>
            Word counter
          </Link>
          <Link to="/about" className={NAV_LINK}>
            About
          </Link>
        </nav>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-8">
        <Outlet />
      </main>
    </>
  )
}

function NotFound() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="mt-2">
        Nothing lives at this address.{' '}
        <Link to="/" className="underline underline-offset-4">
          Go to the word counter
        </Link>
        .
      </p>
    </>
  )
}
