import { Link } from '@tanstack/react-router'
import { APP_NAME } from '#/config/app.ts'

const navLink =
  'rounded-sm text-muted-foreground outline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring data-[status=active]:text-foreground'

/** The header on every page: the main navigation. */
export function SiteHeader() {
  return (
    <header className="border-b">
      <nav aria-label="Main" className="mx-auto flex max-w-2xl gap-4 p-4 text-sm">
        <Link to="/" className={`${navLink} font-semibold`}>
          {APP_NAME}
        </Link>
        <Link to="/about" className={navLink}>
          About
        </Link>
        <Link to="/dashboard" className={`${navLink} ml-auto`}>
          Dashboard
        </Link>
      </nav>
    </header>
  )
}
