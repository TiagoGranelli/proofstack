import { Page } from '#/components/layouts/page.tsx'

/** Router `defaultPendingComponent`: shown only when a navigation takes longer than `defaultPendingMs`. */
export function RoutePending() {
  return (
    <div aria-busy="true">
      <div aria-hidden="true" className="fixed inset-x-0 top-0 h-0.5 bg-primary motion-safe:animate-pulse" />
      {/* Every page has a level-one heading, this one too; the status inside it announces the wait. */}
      <Page title={<output className="text-base font-normal text-muted-foreground">Loading…</output>} />
    </div>
  )
}
