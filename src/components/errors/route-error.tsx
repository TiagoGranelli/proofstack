import { useQueryErrorResetBoundary } from '@tanstack/react-query'
import { type ErrorComponentProps, Link, useRouter } from '@tanstack/react-router'
import { useEffect } from 'react'
import { ApiErrorAlert } from '#/components/errors/api-error-alert.tsx'
import { Button } from '#/components/ui/button.tsx'

/** Router `defaultErrorComponent`: a loader, `beforeLoad` or suspense query failed (SSR or client). */
export function RouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter()
  const queryErrorResetBoundary = useQueryErrorResetBoundary()
  // Lets useSuspenseQuery retry instead of rethrowing the cached error when the route renders again.
  useEffect(() => {
    queryErrorResetBoundary.reset()
  }, [queryErrorResetBoundary])
  return (
    <main className="mx-auto grid max-w-2xl gap-4 p-4">
      <h1 className="text-2xl font-semibold">This page could not be loaded</h1>
      <ApiErrorAlert error={error} action="load this page" />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          onClick={async () => {
            reset()
            await router.invalidate()
          }}
        >
          Try again
        </Button>
        <Button asChild variant="outline">
          <Link to="/">Go to latest posts</Link>
        </Button>
      </div>
    </main>
  )
}

/** Router `defaultPendingComponent`: shown only when a navigation takes longer than `defaultPendingMs`. */
export function RoutePending() {
  return (
    <main className="mx-auto grid max-w-2xl gap-4 p-4" aria-busy="true">
      <div aria-hidden="true" className="fixed inset-x-0 top-0 h-0.5 bg-primary motion-safe:animate-pulse" />
      <output className="text-sm text-muted-foreground">Loading…</output>
    </main>
  )
}

/** Router `defaultNotFoundComponent`. */
export function RouteNotFound() {
  return (
    <main className="mx-auto grid max-w-2xl gap-4 p-4">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-muted-foreground">There is nothing at this address.</p>
      <div>
        <Button asChild variant="outline">
          <Link to="/">Go to latest posts</Link>
        </Button>
      </div>
    </main>
  )
}
