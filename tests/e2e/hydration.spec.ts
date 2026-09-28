// The readiness signal every spec waits for: `body[data-hydrated="true"]` (support/app.ts `visit`) must mean
// that the page's fields are hydrated. Text typed into a field React has not hydrated yet stays on screen but
// never reaches the form's state, so a test that fills it right after the signal sees a form that ignores it
// (the dashboard's Publish stayed disabled with the text in the field, on WebKit under CI load).
import { POST_MAX_LENGTH } from '#/contract/limits.ts'
import { expect, signIn, test, visit } from './support/app.ts'

const TYPED = 'typed the moment the page said it was hydrated'

test('text typed the moment the page reports hydration reaches the form', async ({ page, author }) => {
  // Types into the composer as a user would (focus, the value, an input event), in the same task that sets the
  // attribute: the earliest moment a test may act. The value goes through the prototype's setter, as the browser's
  // own editing does, not React's tracking wrapper on a hydrated field.
  await page.addInitScript((text) => {
    new MutationObserver((_, observer) => {
      const field = document.querySelector<HTMLTextAreaElement>('#post-body')
      if (document.body.dataset.hydrated !== 'true' || !field) return
      observer.disconnect()
      field.focus()
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(field, text)
      field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }))
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-hydrated'] })
  }, TYPED)
  await signIn(page, author)
  await visit(page, '/dashboard')
  await expect(page.getByLabel('New post')).toHaveValue(TYPED)
  await expect(page.getByText(`${TYPED.length}/${POST_MAX_LENGTH}`)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Publish' })).toBeEnabled()
})
