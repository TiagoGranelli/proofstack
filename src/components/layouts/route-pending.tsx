/** Router `defaultPendingComponent`: shown only when a navigation takes longer than `defaultPendingMs`. */
export function RoutePending() {
  return (
    <main className="mx-auto grid max-w-2xl gap-4 p-4" aria-busy="true">
      <div aria-hidden="true" className="fixed inset-x-0 top-0 h-0.5 bg-primary motion-safe:animate-pulse" />
      {/* Every page has a level-one heading, this one too; the status inside it announces the wait. */}
      <h1 className="text-sm font-normal text-muted-foreground">
        <output>Loading…</output>
      </h1>
    </main>
  )
}
