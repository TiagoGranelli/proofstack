// Signing up, confirming the address and recovering a password: the forms, and the /reset-password and
// /verify-email routes (search validation, every token state).
import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { ForgotPasswordForm } from '#/features/auth/components/forgot-password-form.tsx'
import { SignUpForm } from '#/features/auth/components/sign-up-form.tsx'
import type { AuthFailure } from '#/lib/auth.functions.ts'
import { Route as ResetPasswordRoute } from '#/routes/reset-password.tsx'
import { Route as VerifyEmailRoute } from '#/routes/verify-email.tsx'
import { authCalls, authFunction, held, worker } from './api-mocks.ts'
import { expectFocusedStatus, renderInApp, statusText } from './test-utils.tsx'

const unreachable = 'Could not reach the server. Check your connection and try again.'
const expiredLink = 'This link is invalid or has expired. Ask for a new one.'
const formOf = (label: string) =>
  page.elementLocator(page.getByRole('button', { name: label }).element().closest('form')!)

const renderReset = (url: string) =>
  renderInApp(null, { url, route: { path: '/reset-password', route: ResetPasswordRoute } })
const renderVerify = (url: string) =>
  renderInApp(null, { url, route: { path: '/verify-email', route: VerifyEmailRoute } })
const button = (name: string) => page.getByRole('button', { name })
const email = () => page.getByLabelText('Email')
const password = () => page.getByLabelText('Password')
const newPassword = () => page.getByLabelText('New password')
const resend = () => button('Send a new link')

const signUp = async (typed = 'a long enough password') => {
  await page.getByLabelText('Name').fill('  Ada Lovelace ')
  await email().fill(' ada@example.test ')
  await password().fill(typed)
  await button('Create account').click()
}

describe('SignUpForm', () => {
  it('labels its fields for password managers and says what a password needs', async () => {
    await renderInApp(<SignUpForm />, { url: '/sign-up' })
    await expect.element(page.getByLabelText('Name')).toHaveAttribute('autocomplete', 'name')
    await expect.element(email()).toHaveAttribute('type', 'email')
    await expect.element(password()).toHaveAttribute('autocomplete', 'new-password')
    for (const field of [page.getByLabelText('Name'), email(), password()]) await expect.element(field).toBeRequired()
    await expect.element(password()).toHaveAccessibleDescription('At least 12 characters.')
    await expect.element(formOf('Create account')).toHaveAttribute('method', 'post')
  })

  it('does not send a password shorter than 12 characters: says why next to it and moves focus there', async () => {
    const calls = authCalls('signUp')
    worker.use(calls.handler)
    await renderInApp(<SignUpForm />, { url: '/sign-up' })
    await signUp('too short')
    await expect.element(password()).toBeInvalid()
    await expect.element(password()).toHaveFocus()
    await expect.element(password()).toHaveAccessibleDescription('At least 12 characters. Use at least 12 characters.')
    // Checked again as the password is fixed.
    await password().fill('a long enough password')
    await expect.element(password()).not.toHaveAttribute('aria-invalid')
    expect(calls.data).toEqual([])
  })

  it('flags every empty field at once, and focuses the first', async () => {
    const calls = authCalls('signUp')
    worker.use(calls.handler)
    await renderInApp(<SignUpForm />, { url: '/sign-up' })
    await button('Create account').click()
    await expect.element(page.getByLabelText('Name')).toHaveFocus()
    await expect.element(page.getByLabelText('Name')).toHaveAccessibleDescription('Enter your name.')
    await expect.element(email()).toHaveAccessibleDescription('Enter your email address.')
    await expect.element(password()).toHaveAccessibleDescription('At least 12 characters. Use at least 12 characters.')
    expect(calls.data).toEqual([])
  })

  it('sends the trimmed name and address once, busy meanwhile, then points to the inbox', async () => {
    const response = held()
    const calls = authCalls('signUp')
    worker.use(calls.handler, authFunction('signUp', response))
    await renderInApp(<SignUpForm />, { url: '/sign-up' })
    await signUp()
    await expect.element(button('Create account')).toBeDisabled()
    await expect.element(formOf('Create account')).toHaveAttribute('aria-busy', 'true')
    await button('Create account').click({ force: true })
    response.release()
    await expect
      .element(statusText('Confirm your email'))
      .toHaveTextContent(
        'Check your inbox at ada@example.test: open the link we sent to confirm your address, then sign in.',
      )
    await expectFocusedStatus('Confirm your email')
    await expect.element(password()).not.toBeInTheDocument()
    expect(calls.data).toEqual([
      { name: 'Ada Lovelace', email: 'ada@example.test', password: 'a long enough password' },
    ])
  })

  it.each<[string, AuthFailure | 'network', string]>([
    ['a password the server finds too short', { code: 'PASSWORD_TOO_SHORT' }, 'Use at least 12 characters.'],
    ['a rate limit', { code: 'RATE_LIMITED', retryAfter: 60 }, 'Too many attempts. Try again in 60 seconds.'],
    ['an unknown failure', { code: 'FAILED_TO_CREATE_USER' }, 'Something went wrong. Try again.'],
    ['a network failure', 'network', unreachable],
  ])('explains %s and keeps the form', async (_, failure, message) => {
    worker.use(authFunction('signUp', failure === 'network' ? failure : { ok: false, failure }))
    await renderInApp(<SignUpForm />, { url: '/sign-up' })
    await signUp()
    await expect.element(page.getByRole('alert')).toHaveTextContent(message)
    await expect.element(formOf('Create account')).toHaveAccessibleDescription(message)
    await expect.element(button('Create account')).toHaveFocus()
    await expect.element(password()).toHaveValue('a long enough password')
    // No raw Better Auth code (SCREAMING_SNAKE_CASE) reaches the page, whatever the failure.
    expect(document.body.textContent).not.toMatch(/\b[A-Z]+(?:_[A-Z]+)+\b/)
  })
})

describe('ForgotPasswordForm', () => {
  it('asks for the trimmed address, busy meanwhile, then answers without saying whether it has an account', async () => {
    const response = held()
    const calls = authCalls('requestPasswordReset')
    worker.use(calls.handler, authFunction('requestPasswordReset', response))
    await renderInApp(<ForgotPasswordForm />, { url: '/forgot-password' })
    await expect.element(email()).toHaveAttribute('autocomplete', 'email')
    await expect.element(email()).toBeRequired()
    await email().fill(' someone@example.test ')
    await button('Send reset link').click()
    await expect.element(button('Send reset link')).toBeDisabled()
    await expect.element(formOf('Send reset link')).toHaveAttribute('aria-busy', 'true')
    response.release()
    await expect
      .element(statusText('Check your inbox'))
      .toHaveTextContent(
        'If someone@example.test belongs to an account, we sent it a link to choose a new password. The link works for one hour.',
      )
    await expectFocusedStatus('Check your inbox')
    expect(calls.data).toEqual([{ email: 'someone@example.test' }])
  })

  it.each<[string, AuthFailure | 'thrown', string]>([
    ['a rate limit', { code: 'RATE_LIMITED', retryAfter: 1 }, 'Too many attempts. Try again in 1 second.'],
    ['a failing server', 'thrown', unreachable],
  ])('explains %s and lets the visitor retry', async (_, failure, message) => {
    worker.use(authFunction('requestPasswordReset', failure === 'thrown' ? failure : { ok: false, failure }))
    await renderInApp(<ForgotPasswordForm />, { url: '/forgot-password' })
    await email().fill('someone@example.test')
    await button('Send reset link').click()
    await expect.element(page.getByRole('alert')).toHaveTextContent(message)
    await expect.element(button('Send reset link')).toHaveFocus()
    expect(document.body.textContent).not.toContain('Internal Server Error')

    worker.use(authFunction('requestPasswordReset', { ok: true, value: null }))
    await button('Send reset link').click()
    await expect.element(page.getByRole('status')).toBeVisible()
    await expect.element(page.getByRole('alert')).not.toBeInTheDocument()
  })
})

describe('/reset-password', () => {
  it.each([
    ['without a token', '/reset-password'],
    ['with an empty token', '/reset-password?token='],
  ])('%s, sends the visitor to ask for a new link', async (_, url) => {
    const { router } = await renderReset(url)
    await expect.element(page.getByRole('heading', { level: 1 })).toHaveTextContent('Choose a new password')
    await expect.element(page.getByText(/^This page needs the link from the reset email\./)).toBeVisible()
    await expect.element(newPassword()).not.toBeInTheDocument()
    await page.getByRole('link', { name: 'Ask for a new one' }).click()
    await expect.poll(() => router.state.location.pathname).toBe('/forgot-password')
  })

  it('sets the new password with the token, busy meanwhile, clears the cache and offers to sign in', async () => {
    const response = held()
    const calls = authCalls('resetPassword')
    worker.use(calls.handler, authFunction('resetPassword', response))
    const { queryClient } = await renderReset('/reset-password?token=abc123')
    queryClient.setQueryData(['my data'], ['private'])
    await expect.element(newPassword()).toHaveAttribute('autocomplete', 'new-password')
    await expect.element(newPassword()).toHaveAccessibleDescription('At least 12 characters.')
    await newPassword().fill('a brand new password')
    await button('Set new password').click()
    await expect.element(button('Set new password')).toBeDisabled()
    await expect.element(formOf('Set new password')).toHaveAttribute('aria-busy', 'true')
    response.release()
    await expect
      .element(statusText('Password changed'))
      .toHaveTextContent(
        'Your password is changed, and every session of your account was signed out. Sign in with the new password.',
      )
    await expectFocusedStatus('Password changed')
    await expect
      .element(page.getByRole('status').getByRole('link', { name: 'Sign in' }))
      .toHaveAttribute('href', '/login')
    expect(queryClient.getQueryData(['my data'])).toBeUndefined()
    expect(calls.data).toEqual([{ token: 'abc123', newPassword: 'a brand new password' }])
  })

  it('does not send a new password shorter than 12 characters', async () => {
    const calls = authCalls('resetPassword')
    worker.use(calls.handler)
    await renderReset('/reset-password?token=abc123')
    await newPassword().fill('too short')
    await button('Set new password').click()
    await expect.element(newPassword()).toBeInvalid()
    expect(calls.data).toEqual([])
  })

  it.each<[string, AuthFailure, string]>([
    ['an invalid token', { code: 'INVALID_TOKEN' }, expiredLink],
    ['an expired token', { code: 'TOKEN_EXPIRED' }, expiredLink],
    ['a deleted account', { code: 'USER_NOT_FOUND' }, expiredLink],
    ['a password the server finds too long', { code: 'PASSWORD_TOO_LONG' }, 'Use at most 128 characters.'],
  ])('explains %s without the code', async (_, failure, message) => {
    worker.use(authFunction('resetPassword', { ok: false, failure }))
    const { queryClient } = await renderReset('/reset-password?token=abc123')
    queryClient.setQueryData(['my data'], ['private'])
    await newPassword().fill('a brand new password')
    await button('Set new password').click()
    await expect.element(page.getByRole('alert')).toHaveTextContent(message)
    await expect.element(formOf('Set new password')).toHaveAccessibleDescription(message)
    await expect.element(button('Set new password')).toHaveFocus()
    expect(document.body.textContent).not.toContain(failure.code)
    expect(queryClient.getQueryData(['my data'])).toEqual(['private'])
  })
})

describe('/verify-email', () => {
  it('confirms the address only when the button is pressed, then offers to sign in', async () => {
    const response = held()
    const calls = authCalls('verifyEmail')
    worker.use(calls.handler, authFunction('verifyEmail', response))
    const { router } = await renderVerify('/verify-email?token=tok-1')
    await expect.element(page.getByRole('heading', { level: 1 })).toHaveTextContent('Confirm your email')
    // Opening the link (what a mail scanner does too) sends nothing.
    await expect.element(button('Confirm email')).toBeEnabled()
    await expect.element(resend()).not.toBeInTheDocument()
    expect(calls.data).toEqual([])

    await button('Confirm email').click()
    await expect.element(button('Confirm email')).toBeDisabled()
    await expect.element(formOf('Confirm email')).toHaveAttribute('aria-busy', 'true')
    response.release()
    await expect
      .element(statusText('Email confirmed'))
      .toHaveTextContent('Your email address is confirmed. Sign in to continue.')
    await expectFocusedStatus('Email confirmed')
    await expect.element(resend()).not.toBeInTheDocument()
    expect(calls.data).toEqual([{ token: 'tok-1' }])
    await page.getByRole('link', { name: 'Sign in' }).click()
    await expect.poll(() => router.state.location.pathname).toBe('/login')
  })

  it.each<[string, AuthFailure]>([
    ['an invalid', { code: 'INVALID_TOKEN' }],
    ['an expired', { code: 'TOKEN_EXPIRED' }],
  ])('says %s link cannot be used, without the code, and offers a new one', async (_, failure) => {
    worker.use(authFunction('verifyEmail', { ok: false, failure }))
    await renderVerify('/verify-email?token=tok-1')
    await expect.element(resend()).not.toBeInTheDocument()
    await button('Confirm email').click()
    await expect.element(page.getByRole('alert')).toHaveTextContent(expiredLink)
    expect(document.body.textContent).not.toContain(failure.code)
    await expect.element(resend()).toBeEnabled()
  })

  it('without a token, asks for nothing and explains where the link is', async () => {
    const calls = authCalls('verifyEmail')
    worker.use(calls.handler)
    await renderVerify('/verify-email')
    await expect
      .element(page.getByText('Open the link in the email we sent you. Did not get it? Ask for a new one.'))
      .toBeVisible()
    await expect.element(page.getByRole('alert')).not.toBeInTheDocument()
    await expect.element(resend()).toBeEnabled()
    expect(calls.data).toEqual([])
  })

  it('sends a new link to the trimmed address, busy meanwhile, without saying whether it has an account', async () => {
    const response = held()
    const calls = authCalls('resendVerification')
    worker.use(calls.handler, authFunction('resendVerification', response))
    await renderVerify('/verify-email')
    await expect.element(email()).toHaveAttribute('autocomplete', 'email')
    await email().fill(' new@example.test ')
    await resend().click()
    await expect.element(resend()).toBeDisabled()
    await expect.element(formOf('Send a new link')).toHaveAttribute('aria-busy', 'true')
    response.release()
    await expect
      .element(statusText('Check your inbox'))
      .toHaveTextContent('If new@example.test has an account waiting for confirmation, we sent it a new link.')
    await expectFocusedStatus('Check your inbox')
    expect(calls.data).toEqual([{ email: 'new@example.test' }])
  })

  it('explains a failed resend and lets the visitor retry', async () => {
    worker.use(authFunction('resendVerification', 'network'))
    await renderVerify('/verify-email')
    await email().fill('new@example.test')
    await resend().click()
    await expect.element(page.getByRole('alert')).toHaveTextContent(unreachable)
    await expect.element(formOf('Send a new link')).toHaveAccessibleDescription(unreachable)
    await expect.element(resend()).toHaveFocus()
  })
})
