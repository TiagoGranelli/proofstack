// The account page's session list: each session's device, address and times, and its three sign-out actions.
import { describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { SessionList } from '#/features/auth/components/session-list.tsx'
import { authCalls, authFunction, held, worker } from './api-mocks.ts'
import { listed, listSessions, otherName, phone, renderWithSessions, thisBrowser } from './session-views.ts'
import { pressAndKeepFocus } from './test-utils.tsx'

const unreachable = 'Could not reach the server. Check your connection and try again.'

const sessionList = () => page.getByRole('list', { name: 'Active sessions' })
const othersButton = () => page.getByRole('button', { name: 'Sign out other sessions' })
const everywhereButton = () => page.getByRole('button', { name: 'Sign out everywhere' })

describe('SessionList', () => {
  it('lists every session with its device, address and times; only the others can be signed out', async () => {
    await renderWithSessions(<SessionList />, listed(thisBrowser, phone))
    const items = sessionList().getByRole('listitem')
    await expect.element(items.nth(0)).toMatchTextContent('Firefox on Linux(this browser)')
    await expect
      .element(items.nth(0))
      .toMatchTextContent('198.51.100.7 · signed in 2026-09-01 10:00 UTC, last active 2026-09-27 09:00 UTC')
    await expect.element(items.nth(0).getByRole('button')).not.toBeInTheDocument()
    await expect.element(items.nth(1)).toMatchTextContent('Chrome on Windowssigned in 2026-09-01 10:00 UTC')
    await expect.element(items.nth(1)).not.toMatchTextContent('this browser')
    await expect.element(items.nth(1).getByRole('button', { name: otherName })).toBeEnabled()
    await expect.element(othersButton()).toBeEnabled()
  })

  it('cannot sign out other sessions when there are none', async () => {
    await renderWithSessions(<SessionList />, listed(thisBrowser))
    await expect.element(othersButton()).toBeDisabled()
    await expect.element(everywhereButton()).toBeEnabled()
  })

  it('signs out one session, busy meanwhile, then shows the refreshed list', async () => {
    const response = held()
    const calls = authCalls('revokeSession')
    worker.use(calls.handler, authFunction('revokeSession', response), listSessions(thisBrowser))
    await renderWithSessions(<SessionList />, listed(thisBrowser, phone))
    await page.getByRole('button', { name: otherName }).click()
    await expect.element(page.getByRole('button', { name: otherName })).toBeDisabled()
    await expect.element(page.getByRole('button', { name: otherName })).toHaveAttribute('aria-busy', 'true')
    response.release()
    await expect.element(page.getByRole('button', { name: otherName })).not.toBeInTheDocument()
    await expect.element(sessionList().getByRole('listitem')).toMatchTextContent('this browser')
    expect(calls.data).toEqual([{ id: phone.id }])
  })

  it.each([
    ['the server cannot be reached', 'network' as const, unreachable],
    [
      'the session has ended',
      { ok: false, failure: { code: 'SESSION_EXPIRED' } } as const,
      'Your session has ended. Sign in again to continue.',
    ],
  ])('says so next to the session when %s', async (_, answer, message) => {
    worker.use(authFunction('revokeSession', answer))
    await renderWithSessions(<SessionList />, listed(thisBrowser, phone))
    await page.getByRole('button', { name: otherName }).click()
    await expect.element(sessionList().getByRole('listitem').nth(1).getByRole('alert')).toHaveTextContent(message)
    await expect.element(page.getByRole('button', { name: otherName })).toBeEnabled()
  })

  it('signs out the other sessions, busy meanwhile, then shows only this browser', async () => {
    const response = held()
    worker.use(authFunction('revokeOtherSessions', response), listSessions(thisBrowser))
    await renderWithSessions(<SessionList />, listed(thisBrowser, phone))
    await othersButton().click()
    await expect.element(othersButton()).toBeDisabled()
    await expect.element(othersButton()).toHaveAttribute('aria-busy', 'true')
    response.release()
    await expect.element(page.getByRole('button', { name: otherName })).not.toBeInTheDocument()
    await expect.element(othersButton()).toBeDisabled()
    await expect.element(othersButton()).toHaveAttribute('aria-busy', 'false')
  })

  it('says so when signing out the other sessions fails', async () => {
    worker.use(authFunction('revokeOtherSessions', 'thrown'))
    await renderWithSessions(<SessionList />, listed(thisBrowser, phone))
    await othersButton().click()
    await expect.element(page.getByRole('alert')).toHaveTextContent(unreachable)
    await expect.element(othersButton()).toBeEnabled()
    await expect.element(othersButton()).toHaveFocus()
  })

  it('signs out everywhere, busy meanwhile, then clears the cache and goes to sign-in', async () => {
    const response = held()
    // The list stays mounted here after the cache is cleared (in the app, the page is left), so it reloads.
    worker.use(authFunction('signOutEverywhere', response), listSessions())
    const { router, queryClient } = await renderWithSessions(<SessionList />, listed(thisBrowser, phone))
    queryClient.setQueryData(['my data'], ['private'])
    await everywhereButton().click()
    await expect.element(everywhereButton()).toBeDisabled()
    await expect.element(everywhereButton()).toHaveAttribute('aria-busy', 'true')
    response.release()
    await expect.poll(() => router.state.location.href).toBe('/login')
    expect(queryClient.getQueryData(['my data'])).toBeUndefined()
  })

  it('stays and says so when signing out everywhere fails', async () => {
    worker.use(authFunction('signOutEverywhere', { ok: false, failure: { code: 'RATE_LIMITED', retryAfter: 10 } }))
    const { router, queryClient } = await renderWithSessions(<SessionList />, listed(thisBrowser, phone))
    queryClient.setQueryData(['my data'], ['private'])
    await everywhereButton().click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('Too many attempts. Try again in 10 seconds.')
    await expect.element(everywhereButton()).toBeEnabled()
    expect(router.state.location.pathname).toBe('/account')
    expect(queryClient.getQueryData(['my data'])).toEqual(['private'])
  })

  it('asks for a fresh sign-in, then signs out and returns to the account page after it', async () => {
    const response = held()
    worker.use(authFunction('signOut', response))
    const { router } = await renderWithSessions(<SessionList />, { ok: false, failure: { code: 'SESSION_NOT_FRESH' } })
    await expect.element(page.getByText('For your security, sign in again to see your sessions.')).toBeVisible()
    await expect.element(sessionList()).not.toBeInTheDocument()
    const again = page.getByRole('button', { name: 'Sign in again' })
    await again.click()
    await expect.element(again).toBeDisabled()
    response.release()
    await expect.poll(() => router.state.location.href).toBe('/login?redirect=%2Faccount')
  })

  it('says so when signing out for a fresh sign-in fails', async () => {
    worker.use(authFunction('signOut', 'network'))
    const { router } = await renderWithSessions(<SessionList />, { ok: false, failure: { code: 'SESSION_NOT_FRESH' } })
    await page.getByRole('button', { name: 'Sign in again' }).click()
    await expect.element(page.getByRole('alert')).toHaveTextContent(unreachable)
    expect(router.state.location.pathname).toBe('/account')
  })

  // A disabled button loses focus while the browser renders, so these stay focusable (aria-disabled) and
  // ignore presses while their action is pending: a keyboard user who pressed one is still on it when it fails.
  it.each([
    ['one session’s Sign out', 'revokeSession', () => page.getByRole('button', { name: otherName })],
    ['Sign out other sessions', 'revokeOtherSessions', othersButton],
    ['Sign out everywhere', 'signOutEverywhere', everywhereButton],
  ] as const)('keeps focus on %s while pending and after a failure', async (_, name, button) => {
    const response = held()
    const calls = authCalls(name)
    worker.use(calls.handler, authFunction(name, { ...response, answer: 'network' }))
    await renderWithSessions(<SessionList />, listed(thisBrowser, phone))
    await pressAndKeepFocus(button())
    await userEvent.keyboard('{Enter}')
    response.release()
    await expect.element(page.getByRole('alert')).toHaveTextContent(unreachable)
    await expect.element(button()).toHaveFocus()
    await expect.element(button()).not.toHaveAttribute('aria-disabled')
    expect(calls.data).toHaveLength(1)
  })

  it('keeps focus on Sign in again while pending and after a failure', async () => {
    const response = held()
    const calls = authCalls('signOut')
    worker.use(calls.handler, authFunction('signOut', { ...response, answer: 'network' }))
    await renderWithSessions(<SessionList />, { ok: false, failure: { code: 'SESSION_NOT_FRESH' } })
    const again = page.getByRole('button', { name: 'Sign in again' })
    await pressAndKeepFocus(again)
    await userEvent.keyboard('{Enter}')
    response.release()
    await expect.element(page.getByRole('alert')).toHaveTextContent(unreachable)
    await expect.element(again).toHaveFocus()
    expect(calls.data).toHaveLength(1)
  })

  it('shows any other refusal to list the sessions as an alert, without its code', async () => {
    await renderWithSessions(<SessionList />, { ok: false, failure: { code: 'UNAUTHORIZED' } })
    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent('Your session has ended. Sign in again to continue.')
    expect(document.body.textContent).not.toContain('UNAUTHORIZED')
    await expect.element(everywhereButton()).not.toBeInTheDocument()
  })
})
