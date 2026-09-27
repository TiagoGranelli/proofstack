// Router defaults (src/router.tsx): the error, not-found and pending states every route falls back to.
import type { ErrorComponentProps } from '@tanstack/react-router'
import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { RouteError } from '#/components/errors/route-error.tsx'
import { RouteNotFound } from '#/components/errors/route-not-found.tsx'
import { RoutePending } from '#/components/layouts/route-pending.tsx'
import { renderInApp } from './test-utils.tsx'

const props = (error: unknown, reset = vi.fn<() => void>()): ErrorComponentProps => ({ error, reset })

describe('RouteError', () => {
  it('explains the failure, retries the route, and links home', async () => {
    const reset = vi.fn<() => void>()
    const { router } = await renderInApp(<RouteError {...props(new TypeError('Failed to fetch'), reset)} />, {
      url: '/dashboard',
    })
    const invalidate = vi.spyOn(router, 'invalidate')
    await expect.element(page.getByRole('heading', { level: 1 })).toHaveTextContent('This page could not be loaded')
    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent('Could not load this page. Check your connection and try again.')

    await page.getByRole('button', { name: 'Try again' }).click()
    expect(reset).toHaveBeenCalledOnce()
    await expect.poll(() => invalidate.mock.calls.length).toBe(1)

    await page.getByRole('link', { name: 'Go to the home page' }).click()
    await expect.poll(() => router.state.location.pathname).toBe('/')
  })

  it('offers to sign in when a loader hit an ended session', async () => {
    await renderInApp(<RouteError {...props({ _tag: 'Unauthorized', message: 'Authentication required' })} />, {
      url: '/dashboard',
    })
    await expect
      .element(page.getByRole('alert').getByRole('link', { name: 'Sign in' }))
      .toHaveAttribute('href', '/login?redirect=%2Fdashboard')
  })
})

describe('RouteNotFound', () => {
  it('says so and links home', async () => {
    await renderInApp(<RouteNotFound />, { url: '/nowhere' })
    await expect.element(page.getByRole('heading', { level: 1 })).toHaveTextContent('Page not found')
    await expect.element(page.getByRole('link', { name: 'Go to the home page' })).toHaveAttribute('href', '/')
  })
})

describe('RoutePending', () => {
  it('marks the page busy and announces loading politely, under the page heading', async () => {
    await renderInApp(<RoutePending />)
    const heading = page.getByRole('heading', { level: 1 })
    await expect.element(heading).toHaveTextContent('Loading…')
    await expect.element(page.getByRole('status')).toHaveTextContent('Loading…')
    expect(heading.element().closest('[aria-busy]')?.getAttribute('aria-busy')).toBe('true')
  })
})
