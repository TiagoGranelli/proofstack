import { createFileRoute } from '@tanstack/react-router'

// Finite static page: prerendered at build time (see nitro.prerender.routes in vite.config.ts).
export const Route = createFileRoute('/about')({
  head: () => ({ meta: [{ title: 'About · ProofStack' }] }),
  component: About,
})

function About() {
  return (
    <main className="mx-auto grid max-w-2xl gap-3 p-4">
      <h1 className="text-2xl font-semibold">About</h1>
      <p>
        ProofStack is a full-stack template whose API contract, generated SDK, running API and tests are checked against
        each other in CI.
      </p>
    </main>
  )
}
