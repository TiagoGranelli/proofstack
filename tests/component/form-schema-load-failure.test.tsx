// A form whose Schema module (form-schema.ts, loaded on the first interaction by src/components/form/lazy-schema.ts)
// cannot be loaded, as when its chunk request fails on a bad connection: the submit says so in an alert instead
// of doing nothing, sends nothing, and the form stays usable. That the next submit loads again is covered by
// tests/unit/lazy-schema.test.ts: here the module fails for the rest of the file, as Vitest keeps a failed mock.
import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { LoginForm } from '#/features/auth/components/login-form.tsx'
import { PostComposer } from '#/features/posts/components/post-composer.tsx'
import { renderInApp } from './test-utils.tsx'

// A factory that throws breaks Vitest's mocker. Vitest reads the exports of the returned object when it builds
// the module, so the getter fails the module's import instead, as a failed chunk request would.
vi.mock('#/components/form/form-schema.ts', () => ({
  get toFormSchema(): never {
    throw new TypeError('Failed to fetch dynamically imported module')
  },
}))

const SCHEMA_LOAD_FAILED = "Couldn't load the form. Check your connection and try again."
const alert = () => page.getByRole('alert').filter({ hasText: SCHEMA_LOAD_FAILED })

// No auth or API handler: a request would fail the test (setup.ts), so nothing may be sent unvalidated.
describe('a form whose schema cannot be loaded', () => {
  it('says so under the post composer and keeps the draft', async () => {
    await renderInApp(<PostComposer />)
    const field = page.getByLabelText('New post')
    await field.fill('a draft')
    await page.getByRole('button', { name: 'Publish' }).click()

    await expect.element(alert()).toBeVisible()
    await expect.element(field).toHaveValue('a draft')
    await expect
      .element(field)
      .toHaveAccessibleDescription(/Couldn't load the form\. Check your connection and try again\.$/)
  })

  it('says so under the sign-in form, which stays usable', async () => {
    await renderInApp(<LoginForm />, { url: '/login' })
    const signIn = page.getByRole('button', { name: 'Sign in' })
    await signIn.click()

    await expect.element(alert()).toBeVisible()
    await expect.element(signIn).toBeEnabled()
    await expect.element(signIn).not.toHaveAttribute('aria-disabled')
    const email = page.getByRole('textbox', { name: 'Email', exact: true })
    await email.fill('author@example.test')
    await expect.element(email).toHaveValue('author@example.test')
    await signIn.click()
    await expect.element(alert()).toBeVisible()
  })
})
