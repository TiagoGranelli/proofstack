// The account page's change-password form: its fields, what it sends, and every answer it explains.
import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { ChangePasswordForm } from '#/features/auth/components/change-password-form.tsx'
import { SessionList } from '#/features/auth/components/session-list.tsx'
import type { AuthFailure } from '#/lib/auth.functions.ts'
import { authCalls, authFunction, held, worker } from './api-mocks.ts'
import { listed, listSessions, otherName, phone, renderWithSessions, thisBrowser } from './session-views.ts'
import { expectFocusedStatus, formOf, renderInApp, statusText } from './test-utils.tsx'

const unreachable = 'Could not reach the server. Check your connection and try again.'

const currentPassword = () => page.getByLabelText('Current password')
const newPassword = () => page.getByLabelText('New password')
const changeButton = () => page.getByRole('button', { name: 'Change password' })

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
