/**
 * The first Tab stop of every page: jumps past the header to `<main id="main">`, which takes focus (it has
 * `tabIndex={-1}`). A plain anchor, so it works before hydration and without JavaScript. Hidden until focused.
 */
export function SkipLink() {
  return (
    <a
      href="#main"
      className="sr-only rounded-md bg-background px-3 py-2 text-sm font-medium shadow-md focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50"
    >
      Skip to content
    </a>
  )
}
