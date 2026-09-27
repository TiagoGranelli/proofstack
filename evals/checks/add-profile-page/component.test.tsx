// Hidden check of the eval task add-profile-page (the form). The harness copies it to tests/component/ after
// the agent has finished (scripts/agent-eval.ts); it never sits in the agent's checkout.
import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { ProfileNameForm } from '#/features/auth/components/profile-name-form.tsx'
import { authCalls, authFunction, worker } from './api-mocks.ts'
import { renderInApp } from './test-utils.tsx'

// The stub knows `updateName` only once the agent has added it; the name is not in its type before that.
const UPDATE_NAME = 'updateName' as Parameters<typeof authCalls>[0]
const field = () => page.getByRole('textbox', { name: 'Display name', exact: true })
const save = () => page.getByRole('button', { name: 'Save name' })

describe('eval: add-profile-page', () => {
  it('shows the current name and saves the trimmed new one', async () => {
    const calls = authCalls(UPDATE_NAME)
    worker.use(calls.handler, authFunction(UPDATE_NAME, { ok: true, value: null }))
    await renderInApp(<ProfileNameForm name="Alice" />, { url: '/profile' })
    await expect.element(field()).toHaveValue('Alice')
    await field().fill('  Alice Liddell ')
    await save().click()
    await expect.element(page.getByRole('status')).toHaveTextContent('Name saved.')
    expect(calls.data).toEqual([{ name: 'Alice Liddell' }])
  })

  it('cannot save a blank name', async () => {
    await renderInApp(<ProfileNameForm name="Alice" />, { url: '/profile' })
    await field().fill('   ')
    await expect.element(save()).toBeDisabled()
  })

  it('shows why saving failed', async () => {
    worker.use(authFunction(UPDATE_NAME, { ok: false, failure: { code: 'RATE_LIMITED', retryAfter: 5 } }))
    await renderInApp(<ProfileNameForm name="Alice" />, { url: '/profile' })
    await field().fill('Bob')
    await save().click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('Too many attempts. Try again in 5 seconds.')
  })
})
