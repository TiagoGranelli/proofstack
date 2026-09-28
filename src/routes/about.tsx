import { createFileRoute } from '@tanstack/react-router'
import { Page } from '#/components/layouts/page.tsx'
import { pageTitle } from '#/config/app.ts'

// Finite static page: prerendered at build time (see nitro.prerender.routes in vite.config.ts).
export const Route = createFileRoute('/about')({
  head: () => ({ meta: [{ title: pageTitle('About') }] }),
  component: About,
})

function About() {
  return (
    <Page title="About">
      <p className="leading-relaxed text-pretty">
        This app's API contract, generated SDK, running API and tests are checked against each other in CI.
      </p>
    </Page>
  )
}
