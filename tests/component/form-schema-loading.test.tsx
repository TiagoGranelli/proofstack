// The account and post forms load their Effect Schema on the first interaction (src/components/form/lazy-schema.ts),
// not with the page. Here the Schema module (form-schema.ts) is held until the test releases it: it is not asked for
// on render, a submit before it arrives waits for it and then validates, and focus lands on the first invalid field.
// A file of its own, because a loaded schema stays loaded for the rest of a test file.
import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { LoginForm } from '#/features/auth/components/login-form.tsx'
import { renderInApp } from './test-utils.tsx'

// `promise` settles when the test lets the module arrive (`resolve`).
const chunk = vi.hoisted(() => ({ requests: 0, ...Promise.withResolvers<undefined>() }))

vi.mock('#/components/form/form-schema.ts', async (importOriginal) => {
  chunk.requests++
  await chunk.promise
  return importOriginal()
})

describe('a form whose schema has not loaded yet', () => {
  it('asks for it on the first interaction, and a submit before it arrives waits for it, then validates', async () => {
    // No auth handler: a request would fail the test (setup.ts), so an unvalidated submit cannot slip through.
    await renderInApp(<LoginForm />, { url: '/login' })
    await expect.element(page.getByRole('button', { name: 'Sign in' })).toBeEnabled()
    expect(chunk.requests).toBe(0)

    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect.poll(() => chunk.requests).toBe(1)
    const email = page.getByRole('textbox', { name: 'Email', exact: true })
    await expect.element(email).not.toHaveAttribute('aria-invalid')

    chunk.resolve(undefined)
    await expect.element(email).toHaveAttribute('aria-invalid', 'true')
    await expect.element(email).toHaveAccessibleDescription('Enter your email address.')
    await expect.element(email).toHaveFocus()
    expect(chunk.requests).toBe(1)
  })
})
