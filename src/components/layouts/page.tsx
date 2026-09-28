import { type ReactNode, useEffect } from 'react'
import { FlashMessage } from '#/components/layouts/flash-message.tsx'
import { cn } from '#/lib/utils.ts'

/**
 * Sets `<body data-hydrated="true">` once the page's own content has hydrated, for E2E tests: text typed into a
 * field React has not hydrated yet stays in the field but never reaches the form's state. The root layout cannot
 * tell: every route below it renders inside a Suspense boundary (the router's pending component), and React
 * hydrates each of those in a later pass than the layout, so `useHydrated()` there is true while the page's
 * fields are still plain HTML. Every page state (pages, not found, errors) renders a Page, inside its route's
 * boundary.
 */
function MarkHydrated() {
  useEffect(() => {
    document.body.dataset.hydrated = 'true'
  }, [])
  return null
}

/**
 * A page's content inside the root layout's `<main>`: its `<h1>` (which RouteAnnouncer focuses after a
 * navigation, hence `tabIndex={-1}`), an optional line under it, `actions` beside it, then the flash message an
 * action may have left, then `children`. `narrow` suits a single form.
 */
export function Page(props: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  narrow?: boolean
  children?: ReactNode
}) {
  return (
    <div className={cn('mx-auto grid w-full gap-8 px-4 py-10 sm:py-14', props.narrow ? 'max-w-sm' : 'max-w-2xl')}>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="grid gap-2">
          <h1 tabIndex={-1} className="text-3xl font-semibold tracking-tight text-balance outline-none">
            {props.title}
          </h1>
          {props.description === undefined ? null : (
            <p className="text-pretty text-muted-foreground">{props.description}</p>
          )}
        </div>
        {props.actions}
      </div>
      <FlashMessage />
      {props.children}
      <MarkHydrated />
    </div>
  )
}
