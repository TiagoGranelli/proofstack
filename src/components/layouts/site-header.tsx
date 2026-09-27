import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { APP_NAME } from '#/config/app.ts'

// The current page's link is `aria-current="page"` (TanStack marks it `data-status="active"`) and shows it in its
// color; forced colors (Windows High Contrast) drop that color, so there it is underlined instead.
const navLink =
  'rounded-sm text-muted-foreground hover:text-foreground data-[status=active]:text-foreground forced-colors:data-[status=active]:underline'

/** Who is signed in, as the header shows it: `null` signed out, `undefined` not known (a prerendered page). */
type HeaderUser = { readonly name: string } | null | undefined

function AccountLinks(props: { user: HeaderUser; signOut: ReactNode }) {
  const { user } = props
  // A page prerendered at build time cannot know; Dashboard is right either way (its guard sends to sign-in).
  if (user === undefined)
    return (
      <Link to="/dashboard" className={navLink}>
        Dashboard
      </Link>
    )
  if (user === null)
    return (
      <Link to="/login" className={navLink}>
        Sign in
      </Link>
    )
  return (
    <>
      <span className="max-w-48 truncate border-r pr-5 font-medium">{user.name}</span>
      <Link to="/dashboard" className={navLink}>
        Dashboard
      </Link>
      <Link to="/account" className={navLink}>
        Account
      </Link>
      {props.signOut}
    </>
  )
}

/**
 * The header on every page: the main navigation, then the account's links for `user` (see HeaderUser) and its
 * `signOut` control, which the app composes from the auth feature.
 */
export function SiteHeader(props: { user: HeaderUser; signOut: ReactNode }) {
  return (
    <header className="border-b">
      <nav
        aria-label="Main"
        className="mx-auto flex max-w-2xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 text-sm"
      >
        <Link to="/" className="mr-1 rounded-sm font-semibold tracking-tight">
          {APP_NAME}
        </Link>
        <Link to="/about" className={navLink}>
          About
        </Link>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-x-5 gap-y-2">
          <AccountLinks user={props.user} signOut={props.signOut} />
        </div>
      </nav>
    </header>
  )
}
