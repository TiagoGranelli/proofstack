// The account page's parts: change password, the session list with its sign-out actions, and delete account.
import { describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { sessionsQueryKey } from '#/features/auth/api/get-sessions.ts'
import { ChangePasswordForm } from '#/features/auth/components/change-password-form.tsx'
import { DeleteAccountForm } from '#/features/auth/components/delete-account-form.tsx'
import { SessionList } from '#/features/auth/components/session-list.tsx'
import type { AuthFailure, AuthOutcome, SessionView } from '#/lib/auth.functions.ts'
import { authCalls, authFunction, held, worker } from './api-mocks.ts'
import { expectFocusedStatus, pressAndKeepFocus, renderInApp, statusText, testQueryClient } from './test-utils.tsx'

const FIREFOX_LINUX = 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0'
const CHROME_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'

const session = (overrides: Partial<SessionView>): SessionView => ({
  id: crypto.randomUUID(),
  current: false,
  createdAt: '2026-09-01T10:00:00.000Z',
  lastActiveAt: '2026-09-20T12:30:00.000Z',
  ipAddress: '198.51.100.7',
  userAgent: FIREFOX_LINUX,
  ...overrides,
})
const thisBrowser = session({ current: true, lastActiveAt: '2026-09-27T09:00:00.000Z' })
const phone = session({ userAgent: CHROME_WINDOWS, ipAddress: null })
const otherName = 'Sign out Chrome on Windows, signed in 2026-09-01 10:00 UTC'

/** Renders `ui` with the session list already loaded (the route loader does that in the app). */
const renderWithSessions = (ui: React.ReactNode, sessions: AuthOutcome<ReadonlyArray<SessionView>>) => {
  const queryClient = testQueryClient()
  queryClient.setQueryData(sessionsQueryKey, sessions)
  return renderInApp(ui, { url: '/account', queryClient })
}
const listed = (...sessions: SessionView[]) => ({ ok: true, value: sessions }) as const
const listSessions = (...sessions: SessionView[]) =>
  authFunction<ReadonlyArray<SessionView>>('listSessions', listed(...sessions))

const unreachable = 'Could not reach the server. Check your connection and try again.'
const formOf = (button: ReturnType<typeof page.getByRole>) => page.elementLocator(button.element().closest('form')!)

const currentPassword = () => page.getByLabelText('Current password')
const newPassword = () => page.getByLabelText('New password')
const changeButton = () => page.getByRole('button', { name: 'Change password' })
const sessionList = () => page.getByRole('list', { name: 'Active sessions' })
const othersButton = () => page.getByRole('button', { name: 'Sign out other sessions' })
const everywhereButton = () => page.getByRole('button', { name: 'Sign out everywhere' })
const deletePassword = () => page.getByLabelText('Password')
const deleteConfirm = () =>
  page.getByRole('checkbox', { name: 'I understand that my account and all its data are deleted for good.' })
const deleteButton = () => page.getByRole('button', { name: 'Delete account' })

const change = async (typed = 'a brand new password') => {
  await currentPassword().fill('the old password')
  await newPassword().fill(typed)
  await changeButton().click()
}

describe('ChangePasswordForm', () => {
  it('labels its fields for password managers and says what a new password needs', async () => {
    await renderInApp(<ChangePasswordForm />, { url: '/account' })
    await expect.element(currentPassword()).toHaveAttribute('autocomplete', 'current-password')
    await expect.element(newPassword()).toHaveAttribute('autocomplete', 'new-password')
    await expect.element(currentPassword()).toBeRequired()
    await expect.element(newPassword()).toBeRequired()
    await expect
      .element(newPassword())
      .toHaveAccessibleDescription('At least 12 characters. Your other sessions will be signed out.')
  })

  it('does not send a new password shorter than 12 characters', async () => {
    const calls = authCalls('changePassword')
    worker.use(calls.handler)
    await renderInApp(<ChangePasswordForm />, { url: '/account' })
    await change('too short')
    await expect.element(newPassword()).toBeInvalid()
    await expect.element(newPassword()).toHaveFocus()
    await expect
      .element(newPassword())
      .toHaveAccessibleDescription(
        'At least 12 characters. Your other sessions will be signed out. Use at least 12 characters.',
      )
    await expect.element(formOf(changeButton())).toHaveAttribute('aria-busy', 'false')
    expect(calls.data).toEqual([])
  })

  it('changes the password, busy meanwhile, then empties the fields and focuses the news that other sessions were signed out', async () => {
    const response = held()
    const calls = authCalls('changePassword')
    worker.use(calls.handler, authFunction('changePassword', response))
    await renderInApp(<ChangePasswordForm />, { url: '/account' })
    await change()
    await expect.element(changeButton()).toBeDisabled()
    await expect.element(formOf(changeButton())).toHaveAttribute('aria-busy', 'true')
    response.release()
    await expect.element(statusText('Password changed')).toHaveTextContent('Your other sessions were signed out.')
    // The fields were emptied by a fresh form, which has no focus to keep.
    await expectFocusedStatus('Password changed')
    await expect.element(currentPassword()).toHaveValue('')
    await expect.element(newPassword()).toHaveValue('')
    expect(calls.data).toEqual([{ currentPassword: 'the old password', newPassword: 'a brand new password' }])
  })

  it('refreshes the session list, which no longer has the other sessions', async () => {
    worker.use(authFunction('changePassword', { ok: true, value: null }), listSessions(thisBrowser))
    await renderWithSessions(
      <>
        <ChangePasswordForm />
        <SessionList />
      </>,
      listed(thisBrowser, phone),
    )
    await expect.element(page.getByRole('button', { name: otherName })).toBeVisible()
    await change()
    await expect.element(page.getByRole('status')).toBeVisible()
    await expect.element(page.getByRole('button', { name: otherName })).not.toBeInTheDocument()
  })

  it.each<[string, AuthFailure, string]>([
    ['a wrong current password', { code: 'INVALID_PASSWORD' }, 'That password is not correct.'],
    ['a new password the server finds too short', { code: 'PASSWORD_TOO_SHORT' }, 'Use at least 12 characters.'],
    ['a new password the server finds too long', { code: 'PASSWORD_TOO_LONG' }, 'Use at most 128 characters.'],
    ['an ended session', { code: 'SESSION_EXPIRED' }, 'Your session has ended. Sign in again to continue.'],
  ])('explains %s and keeps what was typed', async (_, failure, message) => {
    worker.use(authFunction('changePassword', { ok: false, failure }))
    await renderInApp(<ChangePasswordForm />, { url: '/account' })
    await change()
    await expect.element(page.getByRole('alert')).toHaveTextContent(message)
    await expect.element(formOf(changeButton())).toHaveAccessibleDescription(message)
    await expect.element(changeButton()).toHaveFocus()
    await expect.element(newPassword()).toHaveValue('a brand new password')
    await expect.element(page.getByRole('status')).not.toBeInTheDocument()
  })

  it('shows a generic message when the server fails', async () => {
    worker.use(authFunction('changePassword', 'thrown'))
    await renderInApp(<ChangePasswordForm />, { url: '/account' })
    await change()
    await expect.element(page.getByRole('alert')).toHaveTextContent(unreachable)
    expect(document.body.textContent).not.toContain('Internal Server Error')
  })
})

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

describe('DeleteAccountForm', () => {
  it('needs the password and the confirmation before it sends anything', async () => {
    const calls = authCalls('deleteAccount')
    worker.use(calls.handler)
    await renderInApp(<DeleteAccountForm />, { url: '/account' })
    await expect.element(deletePassword()).toHaveAttribute('autocomplete', 'current-password')
    await expect.element(deletePassword()).toBeRequired()
    await expect.element(deleteConfirm()).toBeRequired()
    await expect.element(deleteConfirm()).not.toBeChecked()

    await deletePassword().fill('my password')
    await deleteButton().click()
    await expect.element(deleteConfirm()).toBeInvalid()
    await expect.element(deleteConfirm()).toHaveFocus()
    await expect.element(deleteConfirm()).toHaveAccessibleDescription('Confirm that you want to delete the account.')

    await deletePassword().clear()
    await deleteConfirm().click()
    await deleteButton().click()
    await expect.element(deletePassword()).toBeInvalid()
    await expect.element(deletePassword()).toHaveFocus()
    await expect.element(deletePassword()).toHaveAccessibleDescription('Enter your password.')
    await expect.element(deleteConfirm()).not.toHaveAttribute('aria-invalid')
    expect(calls.data).toEqual([])
  })

  it('deletes the account, busy meanwhile, then clears the cache and goes home', async () => {
    const response = held()
    const calls = authCalls('deleteAccount')
    worker.use(calls.handler, authFunction('deleteAccount', response))
    const { router, queryClient } = await renderInApp(<DeleteAccountForm />, { url: '/account' })
    queryClient.setQueryData(['my data'], ['private'])
    await deletePassword().fill('my password')
    await deleteConfirm().click()
    await deleteButton().click()
    await expect.element(deleteButton()).toBeDisabled()
    await expect.element(formOf(deleteButton())).toHaveAttribute('aria-busy', 'true')
    response.release()
    await expect.poll(() => router.state.location.href).toBe('/')
    expect(queryClient.getQueryData(['my data'])).toBeUndefined()
    expect(calls.data).toEqual([{ password: 'my password' }])
  })

  it.each([
    [
      'a wrong password',
      { ok: false, failure: { code: 'INVALID_PASSWORD' } } as const,
      'That password is not correct.',
    ],
    ['a failing server', 'thrown' as const, unreachable],
  ])('keeps the account and says so after %s', async (_, answer, message) => {
    worker.use(authFunction('deleteAccount', answer))
    const { router, queryClient } = await renderInApp(<DeleteAccountForm />, { url: '/account' })
    queryClient.setQueryData(['my data'], ['private'])
    await deletePassword().fill('my password')
    await deleteConfirm().click()
    await deleteButton().click()
    await expect.element(page.getByRole('alert')).toHaveTextContent(message)
    await expect.element(formOf(deleteButton())).toHaveAccessibleDescription(message)
    await expect.element(deleteButton()).toHaveFocus()
    expect(router.state.location.pathname).toBe('/account')
    expect(queryClient.getQueryData(['my data'])).toEqual(['private'])
  })
})
