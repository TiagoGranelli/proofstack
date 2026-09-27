// LoginForm and sign-out: pending states, every failure message, and where each success leads.
import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { LoginForm } from '#/features/auth/components/login-form.tsx'
import { SignOutAlert, SignOutButton, useSignOut } from '#/features/auth/components/sign-out-button.tsx'
import { auth, held, worker } from './api-mocks.ts'
import { renderInApp } from './test-utils.tsx'

const email = () => page.getByLabelText('Email')
const password = () => page.getByLabelText('Password')
const signInButton = () => page.getByRole('button', { name: 'Sign in' })
const formOf = () => page.elementLocator(email().element().closest('form')!)

const signIn = async () => {
  await email().fill('author@example.test')
  await password().fill('a long enough password')
  await signInButton().click()
}

describe('LoginForm', () => {
  it('labels its fields for password managers and requires both', async () => {
    await renderInApp(<LoginForm />, { url: '/login' })
    await expect.element(email()).toHaveAttribute('autocomplete', 'username')
    await expect.element(email()).toHaveAttribute('type', 'email')
    await expect.element(password()).toHaveAttribute('autocomplete', 'current-password')
    await expect.element(email()).toBeRequired()
    await expect.element(password()).toBeRequired()
    // A native submit (before hydration) would be a POST to /login, never a GET with the password in the URL.
    await expect.element(formOf()).toHaveAttribute('method', 'post')
    await expect.element(signInButton()).toBeEnabled()
  })

  it('is busy while signing in', async () => {
    const response = held()
    worker.use(auth.signIn(response))
    await renderInApp(<LoginForm />, { url: '/login' })
    await signIn()
    await expect.element(signInButton()).toBeDisabled()
    await expect.element(formOf()).toHaveAttribute('aria-busy', 'true')
    response.release()
    await expect.element(formOf()).toHaveAttribute('aria-busy', 'false')
  })

  it.each([
    ['wrong credentials', 'invalid', 'Wrong email or password.'],
    ['a network failure', 'network', 'Could not reach the server. Check your connection and try again.'],
  ] as const)('shows %s and lets the author retry', async (_, outcome, message) => {
    worker.use(auth.signIn(outcome))
    const { router } = await renderInApp(<LoginForm redirectTo="/about" />, { url: '/login' })
    await signIn()
    await expect.element(page.getByRole('alert')).toHaveTextContent(message)
    await expect.element(formOf()).toHaveAccessibleDescription(message)
    await expect.element(signInButton()).toBeEnabled()
    expect(router.state.location.pathname).toBe('/login')

    // The failure is cleared as soon as the next attempt starts.
    worker.use(auth.signIn(held()))
    await signInButton().click()
    await expect.element(page.getByRole('alert')).not.toBeInTheDocument()
  })

  it.each([
    ['a same-origin path', '/about', '/about'],
    ['no target', undefined, '/dashboard'],
    ['another site', 'https://evil.example/', '/dashboard'],
  ])('after signing in with %s, clears the cache and goes to it', async (_, redirectTo, expected) => {
    worker.use(auth.signIn('ok'))
    const { router, queryClient } = await renderInApp(<LoginForm redirectTo={redirectTo} />, { url: '/login' })
    queryClient.setQueryData(['previous user'], 'private data')
    await signIn()
    await expect.poll(() => router.state.location.href).toBe(expected)
    expect(queryClient.getQueryData(['previous user'])).toBeUndefined()
  })
})

function SignOut() {
  const signOut = useSignOut()
  return (
    <>
      <SignOutButton signOut={signOut} />
      <SignOutAlert signOut={signOut} />
    </>
  )
}

const signOutButton = () => page.getByRole('button', { name: 'Sign out' })

describe('sign-out', () => {
  it('is busy while signing out, then clears the cache and goes home', async () => {
    const response = held()
    worker.use(auth.signOut(response))
    const { router, queryClient } = await renderInApp(<SignOut />, { url: '/dashboard' })
    queryClient.setQueryData(['my posts'], ['private'])
    await signOutButton().click()
    await expect.element(signOutButton()).toBeDisabled()
    await expect.element(signOutButton()).toHaveAttribute('aria-busy', 'true')
    response.release()
    await expect.poll(() => router.state.location.href).toBe('/')
    expect(queryClient.getQueryData(['my posts'])).toBeUndefined()
  })

  it.each(['failed', 'network'] as const)(
    'says so when sign-out %s, keeps the data and can be retried',
    async (outcome) => {
      worker.use(auth.signOut(outcome))
      const { router, queryClient } = await renderInApp(<SignOut />, { url: '/dashboard' })
      queryClient.setQueryData(['my posts'], ['private'])
      await signOutButton().click()
      await expect
        .element(page.getByRole('alert'))
        .toHaveTextContent('Could not sign out. Check your connection and try again.')
      await expect.element(signOutButton()).toBeEnabled()
      expect(router.state.location.pathname).toBe('/dashboard')
      expect(queryClient.getQueryData(['my posts'])).toEqual(['private'])

      worker.use(auth.signOut('ok'))
      await signOutButton().click()
      await expect.poll(() => router.state.location.href).toBe('/')
    },
  )
})
