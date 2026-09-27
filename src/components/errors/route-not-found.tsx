import { Link } from '@tanstack/react-router'
import { Button } from '#/components/ui/button.tsx'

/** Router `defaultNotFoundComponent`. */
export function RouteNotFound() {
  return (
    <main className="mx-auto grid max-w-2xl gap-4 p-4">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-muted-foreground">There is nothing at this address.</p>
      <div>
        <Button asChild variant="outline">
          <Link to="/">Go to the home page</Link>
        </Button>
      </div>
    </main>
  )
}
