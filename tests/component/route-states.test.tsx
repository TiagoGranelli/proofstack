// Router defaults (src/router.tsx) and list empty states.
import type { ErrorComponentProps } from '@tanstack/react-router'
import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { RouteError } from '#/components/errors/route-error.tsx'
import { RouteNotFound } from '#/components/errors/route-not-found.tsx'
import { RoutePending } from '#/components/layouts/route-pending.tsx'
import { PostList } from '#/features/posts/components/post-list.tsx'
import { post } from './api-mocks.ts'
import { renderInApp } from './test-utils.tsx'

const props = (error: unknown, reset = vi.fn()): ErrorComponentProps => ({ error, reset })

describe('RouteError', () => {
  it('explains the failure, retries the route, and links home', async () => {
    const reset = vi.fn()
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

    await page.getByRole('link', { name: 'Go to latest posts' }).click()
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
    await expect.element(page.getByRole('link', { name: 'Go to latest posts' })).toHaveAttribute('href', '/')
  })
})

describe('RoutePending', () => {
  it('marks the page busy and announces loading politely, under the page heading', async () => {
    await renderInApp(<RoutePending />)
    await expect.element(page.getByRole('main')).toHaveAttribute('aria-busy', 'true')
    await expect.element(page.getByRole('status')).toHaveTextContent('Loading…')
    await expect.element(page.getByRole('heading', { level: 1 })).toHaveTextContent('Loading…')
  })
})

describe('PostList', () => {
  it('shows the empty message in place of the list', async () => {
    await renderInApp(<PostList posts={[]} empty="No posts yet." testId="public-posts" />)
    await expect.element(page.getByTestId('public-posts')).toHaveTextContent('No posts yet.')
    await expect.element(page.getByRole('list')).not.toBeInTheDocument()
  })

  it('lists posts in the given order as read-only cards', async () => {
    const posts = [post({ body: 'newer' }), post({ body: 'older', authorName: 'Other Author' })]
    await renderInApp(<PostList posts={posts} empty="No posts yet." testId="public-posts" />)
    const items = page.getByRole('listitem')
    await expect.element(items.nth(0)).toHaveTextContent('newerTest Author · Jan 2, 2026')
    await expect.element(items.nth(1)).toHaveTextContent('olderOther Author · Jan 2, 2026')
    expect(items.elements()).toHaveLength(2)
    expect(page.getByRole('button').elements()).toHaveLength(0)
  })
})
