// The app's routes in Chromium, on a memory history: each page renders inside the root layout, the navigation marks
// the current page, and an unknown path gets the not-found page.
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'
import { routeTree } from '../../src/routeTree.gen.ts'

/** Renders the app's router at `path`, as src/main.tsx does in the browser. */
const renderAt = (path: string) =>
  render(
    <RouterProvider router={createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [path] }) })} />,
  )

const nav = () => page.getByRole('navigation', { name: 'Main' })

describe('routes', () => {
  it('renders the word counter at / and marks it in the navigation', async () => {
    await renderAt('/')
    await expect.element(page.getByRole('heading', { level: 1, name: 'Word counter' })).toBeVisible()
    await expect.element(page.getByRole('textbox', { name: 'Your text' })).toBeVisible()
    await expect.element(nav().getByRole('link', { name: 'Word counter' })).toHaveAttribute('aria-current', 'page')
  })

  it('renders About at /about', async () => {
    await renderAt('/about')
    await expect.element(page.getByRole('heading', { level: 1, name: 'About' })).toBeVisible()
    await expect.element(nav().getByRole('link', { name: 'About' })).toHaveAttribute('aria-current', 'page')
  })

  it('renders the not-found page with a link home for an unknown path', async () => {
    await renderAt('/no-such-page')
    await expect.element(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible()
    await expect.element(page.getByRole('link', { name: 'Go to the word counter' })).toHaveAttribute('href', '/')
  })
})
