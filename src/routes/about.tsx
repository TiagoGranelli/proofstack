import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/about')({
  head: () => ({ meta: [{ title: 'About · Word counter' }] }),
  component: About,
})

function About() {
  return (
    <>
      <h1 className="text-2xl font-semibold">About</h1>
      <p className="mt-2">
        A demo small enough to replace. It exists so that every check in this repository has something to run on: a pure
        function with property tests, a component with state, two routes, and pages that must pass axe and Lighthouse.
      </p>
    </>
  )
}
