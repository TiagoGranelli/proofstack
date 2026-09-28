import { Link } from '@tanstack/react-router'
import { Page } from '#/components/layouts/page.tsx'
import { Button } from '#/components/ui/button.tsx'

/** Router `defaultNotFoundComponent`. Its document title comes from the root route's head(). */
export function RouteNotFound() {
  return (
    <Page title="Page not found" description="There is nothing at this address.">
      <div>
        <Button asChild variant="outline">
          <Link to="/">Go to the home page</Link>
        </Button>
      </div>
    </Page>
  )
}
