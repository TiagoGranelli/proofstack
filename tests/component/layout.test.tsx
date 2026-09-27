// The frame around every page: the header for each session state, the theme choice, the flash message an action
// leaves, and what a client-side navigation does for focus and screen readers.
import { useLocation } from '@tanstack/react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { Page } from '#/components/layouts/page.tsx'
import { RouteAnnouncer } from '#/components/layouts/route-announcer.tsx'
import { SiteHeader } from '#/components/layouts/site-header.tsx'
import { ThemeToggle } from '#/components/layouts/theme-toggle.tsx'
import { pageTitle } from '#/config/app.ts'
import { FLASH_MESSAGES } from '#/lib/flash.ts'
import { renderInApp, serverRendered } from './test-utils.tsx'

const nav = () => page.getByRole('navigation', { name: 'Main' })
const link = (name: string) => nav().getByRole('link', { name, exact: true })
const radio = (name: string) => page.getByRole('radio', { name })

afterEach(() => {
  localStorage.clear()
  delete document.documentElement.dataset.theme
})

describe('SiteHeader', () => {
  it('offers to sign in when signed out', async () => {
    await renderInApp(<SiteHeader user={null} signOut={<button type="button">Sign out</button>} />)
    await expect.element(link('Sign in')).toHaveAttribute('href', '/login')
    await expect.element(link('Dashboard')).not.toBeInTheDocument()
    await expect.element(page.getByRole('button', { name: 'Sign out' })).not.toBeInTheDocument()
  })

  it('shows who is signed in, their pages and Sign out', async () => {
    await renderInApp(<SiteHeader user={{ name: 'Ada Lovelace' }} signOut={<button type="button">Sign out</button>} />)
    await expect.element(nav().getByText('Ada Lovelace')).toBeVisible()
    await expect.element(link('Dashboard')).toHaveAttribute('href', '/dashboard')
    await expect.element(link('Account')).toHaveAttribute('href', '/account')
    await expect.element(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
    await expect.element(link('Sign in')).not.toBeInTheDocument()
  })

  it('links only to the dashboard when it cannot know (a prerendered page), which suits either state', async () => {
    await renderInApp(<SiteHeader user={undefined} signOut={<button type="button">Sign out</button>} />)
    await expect.element(link('Dashboard')).toBeVisible()
    await expect.element(link('Sign in')).not.toBeInTheDocument()
    await expect.element(page.getByRole('button', { name: 'Sign out' })).not.toBeInTheDocument()
  })

  it('marks the current page', async () => {
    await renderInApp(<SiteHeader user={null} signOut={null} />, { url: '/about' })
    await expect.element(link('About')).toHaveAttribute('aria-current', 'page')
  })
})

describe('ThemeToggle', () => {
  it('follows the system until a theme is chosen, then applies and keeps the choice', async () => {
    await renderInApp(<ThemeToggle />)
    await expect.element(page.getByRole('group', { name: 'Theme' })).toBeVisible()
    await expect.element(radio('System')).toBeChecked()
    await radio('Dark').click()
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem('theme')).toBe('dark')
    await userEvent.keyboard('{ArrowRight}')
    await expect.element(radio('System')).toBeChecked()
    expect(document.documentElement.dataset.theme).toBeUndefined()
    expect(localStorage.getItem('theme')).toBeNull()
  })

  it('renders System on the server and the stored choice once hydrated, without a mismatch', async () => {
    localStorage.setItem('theme', 'light')
    const rendered = await serverRendered(<ThemeToggle />)
    await expect.element(rendered.screen.getByRole('radio', { name: 'System' })).toBeChecked()
    rendered.hydrate()
    await expect.element(rendered.screen.getByRole('radio', { name: 'Light' })).toBeChecked()
    expect(rendered.mismatches).toEqual([])
  })
})

/**
 * The page at the current path, as the app renders it: a heading naming the path, and a new page (a new `Page`)
 * for every path, as each route has its own component.
 */
function PathPage() {
  const pathname = useLocation({ select: (location) => location.pathname })
  return <Page key={pathname} title={`Page ${pathname}`} />
}

describe('a flash message', () => {
  it('shows under the page heading when an action navigated here with one', async () => {
    const { router } = await renderInApp(<PathPage />, { url: '/dashboard' })
    await router.navigate({ to: '/', state: { flash: 'signed-out' } })
    await expect.element(page.getByTestId('flash')).toHaveTextContent('You are signed out.')
    await router.navigate({ to: '/about' })
    await expect.element(page.getByRole('heading', { name: 'Page /about' })).toBeVisible()
    await expect.element(page.getByTestId('flash')).not.toBeInTheDocument()
  })

  it('is dropped from the history entry once shown, and stays on screen until the next navigation', async () => {
    const { router } = await renderInApp(<PathPage />, { url: '/dashboard' })
    await router.navigate({ to: '/login', state: { flash: 'password-reset' } })
    await expect.element(page.getByTestId('flash')).toBeVisible()
    await expect.poll(() => router.state.location.state.flash).toBeUndefined()
    // Still the same entry (the back button goes to /dashboard), and still showing the message.
    expect(router.history.length).toBe(2)
    await expect.element(page.getByTestId('flash')).toHaveTextContent(FLASH_MESSAGES['password-reset'])
  })

  it('shows a new flash on the same page, pushed as a new entry', async () => {
    const { router } = await renderInApp(<PathPage />, { url: '/' })
    await router.navigate({ to: '/', state: { flash: 'signed-out' } })
    await expect.element(page.getByTestId('flash')).toHaveTextContent('You are signed out.')
  })
})

const renderPages = () =>
  renderInApp(
    <main>
      <PathPage />
      <RouteAnnouncer />
    </main>,
    { url: '/' },
  )
const announcer = () => document.querySelector('[aria-live="polite"]')!

describe('RouteAnnouncer', () => {
  it('moves focus to the new page heading and announces the title after a navigation', async () => {
    const { router } = await renderPages()
    document.title = pageTitle('About')
    await router.navigate({ to: '/about' })
    await expect.element(page.getByRole('heading', { level: 1 })).toHaveFocus()
    await expect.element(page.getByRole('heading', { level: 1 })).toHaveTextContent('Page /about')
    await expect.poll(() => announcer().textContent).toBe(pageTitle('About'))
  })

  it('announces the flash message an action left, after the title', async () => {
    const { router } = await renderPages()
    document.title = pageTitle('Latest posts')
    await router.navigate({ to: '/about' })
    await router.navigate({ to: '/', state: { flash: 'account-deleted' } })
    await expect
      .poll(() => announcer().textContent)
      .toBe(`${pageTitle('Latest posts')}. Your account and everything in it are deleted.`)
  })

  it('stays quiet and leaves focus alone when only the search changes', async () => {
    const { router } = await renderPages()
    await router.navigate({ to: '/', search: { page: 2 } as never })
    await expect.poll(() => router.state.location.searchStr).toBe('?page=2')
    expect(announcer().textContent).toBe('')
    expect(document.activeElement).toBe(document.body)
  })
})
