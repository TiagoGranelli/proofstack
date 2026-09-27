// The account page's delete-account form: what it needs before it sends, and what follows each answer.
import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { DeleteAccountForm } from '#/features/auth/components/delete-account-form.tsx'
import { authCalls, authFunction, held, worker } from './api-mocks.ts'
import { formOf, renderInApp } from './test-utils.tsx'

const unreachable = 'Could not reach the server. Check your connection and try again.'

const deletePassword = () => page.getByLabelText('Password')
const deleteConfirm = () =>
  page.getByRole('checkbox', { name: 'I understand that my account and all its data are deleted for good.' })
const deleteButton = () => page.getByRole('button', { name: 'Delete account' })

/** The form refused to send because of `field`: flagged invalid, focused, and described by `message`. */
const expectFlagged = async (field: ReturnType<typeof page.getByRole>, message: string) => {
  await expect.element(field).toBeInvalid()
  await expect.element(field).toHaveFocus()
  await expect.element(field).toHaveAccessibleDescription(message)
}

describe('DeleteAccountForm', () => {
  it('labels the password for password managers and requires it and an unchecked confirmation', async () => {
    await renderInApp(<DeleteAccountForm />, { url: '/account' })
    await expect.element(deletePassword()).toHaveAttribute('autocomplete', 'current-password')
    await expect.element(deletePassword()).toBeRequired()
    await expect.element(deleteConfirm()).toBeRequired()
    await expect.element(deleteConfirm()).not.toBeChecked()
  })

  it('needs the password and the confirmation before it sends anything', async () => {
    const calls = authCalls('deleteAccount')
    worker.use(calls.handler)
    await renderInApp(<DeleteAccountForm />, { url: '/account' })

    await deletePassword().fill('my password')
    await deleteButton().click()
    await expectFlagged(deleteConfirm(), 'Confirm that you want to delete the account.')

    await deletePassword().clear()
    await deleteConfirm().click()
    await deleteButton().click()
    await expectFlagged(deletePassword(), 'Enter your password.')
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
